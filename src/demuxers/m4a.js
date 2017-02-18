import AVDemuxer from '../demuxer';

// common file type identifiers
// see http://mp4ra.org/filetype.html for a complete list
const MP4_TYPES = ['M4A ', 'M4P ', 'M4B ', 'M4V ', 'isom', 'mp42', 'qt  '];

export default class M4ADemuxer extends AVDemuxer {
  constructor(source, chunk) {
    super(source, chunk);

    // current atom heirarchy stacks
    this.atoms = [];
    this.offsets = [];

    // m4a files can have multiple tracks
    this.track = null;
    this.tracks = [];

    // corrections to bits per channel, base on formatID
    // (ffmpeg appears to always encode the bitsPerChannel as 16)
    this.BITS_PER_CHANNEL = {
      ulaw: 8,
      alaw: 8,
      in24: 24,
      in32: 32,
      fl32: 32,
      fl64: 64,
    };

    // lookup table for atom handlers
    this.lookup_table_atoms = {};

    // lookup table of container atom names
    this.lookup_table_containers = {};

    this.buildAtoms();
  }

  buildAtoms() {
    // declare a function to be used for parsing a given atom name
    const atom = (name, fn) => {
      const c = [];
      for (const container of Array.from(name.split('.').slice(0, -1))) {
        c.push(container);
        this.lookup_table_containers[c.join('.')] = true;
      }

      if (this.lookup_table_atoms[name] == null) {
        this.lookup_table_atoms[name] = {};
      }
      this.lookup_table_atoms[name].fn = fn;
    };

    // declare a function to be called after parsing of an atom and all sub-atoms has completed
    const after = (name, fn) => {
      if (this.lookup_table_atoms[name] == null) {
        this.lookup_table_atoms[name] = {};
      }
      this.lookup_table_atoms[name].after = fn;
    };

    atom('ftyp', () => {
      if (!MP4_TYPES.includes(this.stream.readString(4))) {
        this.emit('error', 'Not a valid M4A file.');
        return;
      }
      this.stream.advance(this.len - 4);
    });

    atom('moov.trak', () => {
      this.track = {};
      this.tracks.push(this.track);
    });

    atom('moov.trak.tkhd', () => {
      this.stream.advance(4); // version and flags

      this.stream.advance(8); // creation and modification time
      this.track.id = this.stream.readUInt32();

      this.stream.advance(this.len - 16);
    });

    atom('moov.trak.mdia.hdlr', () => {
      this.stream.advance(4); // version and flags

      this.stream.advance(4); // component type
      this.track.type = this.stream.readString(4);

      this.stream.advance(12); // component manufacturer, flags, and mask
      this.stream.advance(this.len - 24); // component name
    });

    atom('moov.trak.mdia.mdhd', () => {
      this.stream.advance(4); // version and flags
      this.stream.advance(8); // creation and modification dates

      this.track.timeScale = this.stream.readUInt32();
      this.track.duration = this.stream.readUInt32();

      this.stream.advance(4); // language and quality
    });

    atom('moov.trak.mdia.minf.stbl.stsd', () => {
      this.stream.advance(4); // version and flags

      const numEntries = this.stream.readUInt32();

      // just ignore the rest of the atom if this isn't an audio track
      if (this.track.type !== 'soun') {
        this.stream.advance(this.len - 8);
        return;
      }

      if (numEntries !== 1) {
        this.emit('error', 'Only expecting one entry in sample description atom!');
        return;
      }

      this.stream.advance(4); // size

      this.track.format = {};
      this.track.format.formatID = this.stream.readString(4);

      this.stream.advance(6); // reserved
      this.stream.advance(2); // data reference index

      const version = this.stream.readUInt16();
      this.stream.advance(6); // skip revision level and vendor

      this.track.format.channelsPerFrame = this.stream.readUInt16();
      this.track.format.bitsPerChannel = this.stream.readUInt16();

      this.stream.advance(4); // skip compression id and packet size

      this.track.format.sampleRate = this.stream.readUInt16();
      this.stream.advance(2);

      if (version === 1) {
        this.track.format.framesPerPacket = this.stream.readUInt32();
        this.stream.advance(4); // bytes per packet
        this.track.format.bytesPerFrame = this.stream.readUInt32();
        this.stream.advance(4); // bytes per sample
      } else if (version !== 0) {
        this.emit('error', 'Unknown version in stsd atom');
      }

      if (this.BITS_PER_CHANNEL[this.track.format.formatID] != null) {
        this.track.format.bitsPerChannel = this.BITS_PER_CHANNEL[this.track.format.formatID];
      }

      this.track.format.floatingPoint = ['fl32', 'fl64'].includes(this.track.format.formatID);
      this.track.format.littleEndian = (this.track.format.formatID === 'sowt') && (this.track.format.bitsPerChannel > 8);

      if (['twos', 'sowt', 'in24', 'in32', 'fl32', 'fl64', 'raw ', 'NONE'].includes(this.track.format.formatID)) {
        this.track.format.formatID = 'lpcm';
      }
    });

    atom('moov.trak.mdia.minf.stbl.stsd.alac', () => {
      this.stream.advance(4);
      this.track.cookie = this.stream.readBuffer(this.len - 4);
    });

    atom('moov.trak.mdia.minf.stbl.stsd.esds', () => {
      const offset = this.stream.offset + this.len;
      this.track.cookie = M4ADemuxer.readEsds(this.stream);
      this.stream.seek(offset); // skip garbage at the end
    });

    atom('moov.trak.mdia.minf.stbl.stsd.wave.enda', () => {
      this.track.format.littleEndian = !!this.stream.readUInt16();
    });

    // time to sample
    atom('moov.trak.mdia.minf.stbl.stts', () => {
      this.stream.advance(4); // version and flags

      const entries = this.stream.readUInt32();
      this.track.stts = [];
      for (let i = 0; i < entries; i++) {
        this.track.stts[i] = {
          count: this.stream.readUInt32(),
          duration: this.stream.readUInt32(),
        };
      }

      this.setupSeekPoints();
    });

    // sample to chunk
    atom('moov.trak.mdia.minf.stbl.stsc', () => {
      this.stream.advance(4); // version and flags

      const entries = this.stream.readUInt32();
      this.track.stsc = [];
      for (let i = 0; i < entries; i++) {
        this.track.stsc[i] = {
          first: this.stream.readUInt32(),
          count: this.stream.readUInt32(),
          id: this.stream.readUInt32(),
        };
      }

      this.setupSeekPoints();
    });

    // sample size
    atom('moov.trak.mdia.minf.stbl.stsz', () => {
      this.stream.advance(4); // version and flags

      this.track.sampleSize = this.stream.readUInt32();
      const entries = this.stream.readUInt32();

      if ((this.track.sampleSize === 0) && (entries > 0)) {
        this.track.sampleSizes = [];
        for (let i = 0; i < entries; i++) {
          this.track.sampleSizes[i] = this.stream.readUInt32();
        }
      }

      this.setupSeekPoints();
    });

    // chunk offsets
    atom('moov.trak.mdia.minf.stbl.stco', () => {
      // TODO: co64
      this.stream.advance(4); // version and flags

      const entries = this.stream.readUInt32();
      this.track.chunkOffsets = [];
      for (let i = 0; i < entries; i++) {
        this.track.chunkOffsets[i] = this.stream.readUInt32();
      }

      this.setupSeekPoints();
    });

    // chapter track reference
    atom('moov.trak.tref.chap', () => {
      const entries = this.len >> 2;
      this.track.chapterTracks = [];
      for (let i = 0, end = entries; i < end; i++) {
        this.track.chapterTracks[i] = this.stream.readUInt32();
      }
    });

    after('moov', () => {
      // if the mdat block was at the beginning rather than the end, jump back to it
      if (this.mdatOffset != null) {
        this.stream.seek(this.mdatOffset - 8);
      }

      // choose a track
      for (const track of Array.from(this.tracks)) {
        if (track.type === 'soun') {
          this.track = track;
          break;
        }
      }

      if (this.track.type !== 'soun') {
        this.track = null;
        this.emit('error', 'No audio tracks in m4a file.');
        return;
      }

      // emit info
      this.emit('format', this.track.format);
      this.emit('duration', ((this.track.duration / this.track.timeScale) * 1000) | 0);
      if (this.track.cookie) {
        this.emit('cookie', this.track.cookie);
      }

      // use the seek points from the selected track
      this.seekPoints = this.track.seekPoints;
    });

    atom('mdat', () => {
      if (!this.startedData) {
        if (this.mdatOffset == null) {
          this.mdatOffset = this.stream.offset;
        }
        // if we haven't read the headers yet, the mdat atom was at the beginning
        // rather than the end. Skip over it for now to read the headers first, and
        // come back later.
        if (this.tracks.length === 0) {
          const bytes = Math.min(this.stream.remainingBytes(), this.len);
          this.stream.advance(bytes);
          this.len -= bytes;
          return;
        }

        this.chunkIndex = 0;
        this.stscIndex = 0;
        this.sampleIndex = 0;
        this.tailOffset = 0;
        this.tailSamples = 0;

        this.startedData = true;
      }

      // read the chapter information if any
      if (!this.readChapters) {
        this.readChapters = this.parseChapters();
        // NOTE: Not sure why there is an assignment here, and don't know the proper fix.
        if (this.break = !this.readChapters) {
          return;
        }
        this.stream.seek(this.mdatOffset);
      }

      // get the starting offset
      const offset = this.track.chunkOffsets[this.chunkIndex] + this.tailOffset;
      let length = 0;

      // make sure we have enough data to get to the offset
      if (!this.stream.available(offset - this.stream.offset)) {
        this.break = true;
        return;
      }

      // seek to the offset
      this.stream.seek(offset);

      // calculate the maximum length we can read at once
      while (this.chunkIndex < this.track.chunkOffsets.length) {
        // calculate the size in bytes of the chunk using the sample size table
        const numSamples = this.track.stsc[this.stscIndex].count - this.tailSamples;
        let chunkSize = 0;
        let sample;
        for (sample = 0; sample < numSamples; sample++) {
          const size = this.track.sampleSize || this.track.sampleSizes[this.sampleIndex];

          // if we don't have enough data to add this sample, jump out
          if (!this.stream.available(length + size)) { break; }

          length += size;
          chunkSize += size;
          this.sampleIndex++;
        }

        // if we didn't make it through the whole chunk, add what we did use to the tail
        if (sample < numSamples) {
          this.tailOffset += chunkSize;
          this.tailSamples += sample;
          break;
        } else {
          // otherwise, we can move to the next chunk
          this.chunkIndex++;
          this.tailOffset = 0;
          this.tailSamples = 0;

          // if we've made it to the end of a list of subsequent chunks with the same number of samples,
          // go to the next sample to chunk entry
          if (((this.stscIndex + 1) < this.track.stsc.length) && ((this.chunkIndex + 1) === this.track.stsc[this.stscIndex + 1].first)) {
            this.stscIndex++;
          }

          // if the next chunk isn't right after this one, jump out
          if ((offset + length) !== this.track.chunkOffsets[this.chunkIndex]) {
            break;
          }
        }
      }

      // emit some data if we have any, otherwise wait for more
      if (length > 0) {
        this.emit('data', this.stream.readBuffer(length));
        this.break = this.chunkIndex === this.track.chunkOffsets.length;
      }
      this.break = true;
    });

    // metadata chunk
    atom('moov.udta.meta', () => {
      this.metadata = {};
      this.stream.advance(4); // version and flags
    });

    // emit when we're done
    after('moov.udta.meta', () => this.emit('metadata', this.metadata));

    // convienience function to generate metadata atom handler
    const meta = (field, name, fn) =>
      atom(`moov.udta.meta.ilst.${field}.data`, () => {
        this.stream.advance(8);
        this.len -= 8;
        return fn.call(this, name);
      });

    // string field reader
    const string = (field) => {
      this.metadata[field] = this.stream.readString(this.len, 'utf8');
    };

    // from http://atomicparsley.sourceforge.net/mpeg-4files.html
    meta('©alb', 'album', string);
    meta('©arg', 'arranger', string);
    meta('©art', 'artist', string);
    meta('©ART', 'artist', string);
    meta('aART', 'albumArtist', string);
    meta('catg', 'category', string);
    meta('©com', 'composer', string);
    meta('©cpy', 'copyright', string);
    meta('cprt', 'copyright', string);
    meta('©cmt', 'comments', string);
    meta('©day', 'releaseDate', string);
    meta('desc', 'description', string);
    meta('©gen', 'genre', string); // custom genres
    meta('©grp', 'grouping', string);
    meta('©isr', 'ISRC', string);
    meta('keyw', 'keywords', string);
    meta('©lab', 'recordLabel', string);
    meta('ldes', 'longDescription', string);
    meta('©lyr', 'lyrics', string);
    meta('©nam', 'title', string);
    meta('©phg', 'recordingCopyright', string);
    meta('©prd', 'producer', string);
    meta('©prf', 'performers', string);
    meta('purd', 'purchaseDate', string);
    meta('purl', 'podcastURL', string);
    meta('©swf', 'songwriter', string);
    meta('©too', 'encoder', string);
    meta('©wrt', 'composer', string);

    meta('covr', 'coverArt', (field) => {
      this.metadata[field] = this.stream.readBuffer(this.len);
    });

    /* istanbul ignore next */
    meta('gnre', 'genre', (field) => {
      // standard genres
      const genres = [
        'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge',
        'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B',
        'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska',
        'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient',
        'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical',
        'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
        'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop',
        'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial',
        'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy',
        'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle',
        'Native American', 'Cabaret', 'New Wave', 'Psychadelic', 'Rave', 'Showtunes',
        'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro',
        'Musical', 'Rock & Roll', 'Hard Rock', 'Folk', 'Folk/Rock', 'National Folk',
        'Swing', 'Fast Fusion', 'Bebob', 'Latin', 'Revival', 'Celtic', 'Bluegrass',
        'Avantgarde', 'Gothic Rock', 'Progressive Rock', 'Psychedelic Rock', 'Symphonic Rock',
        'Slow Rock', 'Big Band', 'Chorus', 'Easy Listening', 'Acoustic', 'Humour', 'Speech',
        'Chanson', 'Opera', 'Chamber Music', 'Sonata', 'Symphony', 'Booty Bass', 'Primus',
        'Porn Groove', 'Satire', 'Slow Jam', 'Club', 'Tango', 'Samba', 'Folklore', 'Ballad',
        'Power Ballad', 'Rhythmic Soul', 'Freestyle', 'Duet', 'Punk Rock', 'Drum Solo',
        'A Capella', 'Euro-House', 'Dance Hall',
      ];
      this.metadata[field] = genres[this.stream.readUInt16() - 1];
    });

    meta('tmpo', 'tempo', (field) => {
      this.metadata[field] = this.stream.readUInt16();
    });

    meta('rtng', 'rating', (field) => {
      const rating = this.stream.readUInt8();
      if (rating === 2) {
        this.metadata[field] = 'Clean';
      } else if (rating !== 0) {
        this.metadata[field] = 'Explicit';
      } else {
        this.metadata[field] = 'None';
      }
    });

    const diskTrack = (field) => {
      this.stream.advance(2);
      this.metadata[field] = `${this.stream.readUInt16()} of ${this.stream.readUInt16()}`;
      this.stream.advance(this.len - 6);
    };

    meta('disk', 'diskNumber', diskTrack);
    meta('trkn', 'trackNumber', diskTrack);

    const bool = (field) => {
      this.metadata[field] = this.stream.readUInt8() === 1;
    };

    meta('cpil', 'compilation', bool);
    meta('pcst', 'podcast', bool);
    meta('pgap', 'gapless', bool);
  }

  static probe(buffer) {
    return (buffer.peekString(4, 4) === 'ftyp') && MP4_TYPES.includes(buffer.peekString(8, 4));
  }

  readChunk() {
    this.break = false;

    while (this.stream.available(1) && !this.break) {
      // if we're ready to read a new atom, add it to the stack
      if (!this.readHeaders) {
        if (!this.stream.available(8)) {
          return;
        }

        this.len = this.stream.readUInt32() - 8;
        this.type = this.stream.readString(4);

        if (this.len === 0) { continue; }

        this.atoms.push(this.type);
        this.offsets.push(this.stream.offset + this.len);
        this.readHeaders = true;
      }

      // find a handler for the current atom heirarchy
      const path = this.atoms.join('.');
      let handler = this.lookup_table_atoms[path];

      if (handler && handler.fn) {
        // wait until we have enough data, unless this is the mdat atom
        if (!this.stream.available(this.len) && (path !== 'mdat')) {
          return;
        }

        // call the parser for the atom type
        handler.fn.call(this);

        // check if this atom can contain sub-atoms
        if (path in this.lookup_table_containers) {
          this.readHeaders = false;
        }
      } else if (path in this.lookup_table_containers) {
        // handle container atoms
        this.readHeaders = false;
        // unknown atom
      } else {
        // wait until we have enough data
        if (!this.stream.available(this.len)) {
          return;
        }
        this.stream.advance(this.len);
      }

      // pop completed items from the stack
      while (this.stream.offset >= this.offsets[this.offsets.length - 1]) {
        // call after handler
        handler = this.lookup_table_atoms[this.atoms.join('.')];
        if (handler && handler.after) {
          handler.after.call(this);
        }

        const type = this.atoms.pop();
        this.offsets.pop();
        this.readHeaders = false;
      }
    }
  }

    // reads a variable length integer
  static readDescrLen(stream) {
    let len = 0;
    let count = 4;

    while (count--) {
      const c = stream.readUInt8();
      len = (len << 7) | (c & 0x7f);
      if (!(c & 0x80)) { break; }
    }

    return len;
  }

  static readEsds(stream) {
    stream.advance(4); // version and flags

    let tag = stream.readUInt8();
    let len = M4ADemuxer.readDescrLen(stream);

    if (tag === 0x03) { // MP4ESDescrTag
      stream.advance(2); // id
      const flags = stream.readUInt8();

      if (flags & 0x80) { // streamDependenceFlag
        stream.advance(2);
      }

      if (flags & 0x40) { // URL_Flag
        stream.advance(stream.readUInt8());
      }

      if (flags & 0x20) { // OCRstreamFlag
        stream.advance(2);
      }
    } else {
      stream.advance(2); // id
    }

    tag = stream.readUInt8();
    len = M4ADemuxer.readDescrLen(stream);

    if (tag === 0x04) { // MP4DecConfigDescrTag
      const codec_id = stream.readUInt8(); // might want this... (isom.c:35)
      stream.advance(1); // stream type
      stream.advance(3); // buffer size
      stream.advance(4); // max bitrate
      stream.advance(4); // avg bitrate

      tag = stream.readUInt8();
      len = M4ADemuxer.readDescrLen(stream);

      if (tag === 0x05) { // MP4DecSpecificDescrTag
        return stream.readBuffer(len);
      }
    }

    return null;
  }

    // once we have all the information we need, generate the seek table for this track
  setupSeekPoints() {
    if ((this.track.chunkOffsets == null) || (this.track.stsc == null) || (this.track.sampleSize == null) || (this.track.stts == null)) {
      return;
    }

    let stscIndex = 0;
    let sttsIndex = 0;
    let sttsSample = 0;
    let sampleIndex = 0;

    let offset = 0;
    let timestamp = 0;
    this.track.seekPoints = [];

    const result = [];
    for (let i = 0; i < this.track.chunkOffsets.length; i++) {
      let position = this.track.chunkOffsets[i];
      let item;
      for (let j = 0; j < this.track.stsc[stscIndex].count; j++) {
        // push the timestamp and both the physical position in the file
        // and the offset without gaps from the start of the data
        this.track.seekPoints.push({
          offset,
          position,
          timestamp,
        });

        const size = this.track.sampleSize || this.track.sampleSizes[sampleIndex++];
        offset += size;
        position += size;
        timestamp += this.track.stts[sttsIndex].duration;

        if (((sttsIndex + 1) < this.track.stts.length) && (++sttsSample === this.track.stts[sttsIndex].count)) {
          sttsSample = 0;
          sttsIndex++;
        }
      }

      if (((stscIndex + 1) < this.track.stsc.length) && ((i + 1) === this.track.stsc[stscIndex + 1].first)) {
        item = stscIndex++;
      }
      result.push(item);
    }
  }

  parseChapters() {
    this.track.chapterTracks = this.track.chapterTracks || [];
    if (this.track.chapterTracks.length <= 0) {
      return true;
    }

    // find the chapter track
    const id = this.track.chapterTracks[0];
    let track;
    for (track of this.tracks) {
      if (track.id === id) {
        break;
      }
    }

    if (track.id !== id) {
      this.emit('error', 'Chapter track does not exist.');
    }

    if (this.chapters == null) {
      this.chapters = [];
    }

    // use the seek table offsets to find chapter titles
    while (this.chapters.length < track.seekPoints.length) {
      const point = track.seekPoints[this.chapters.length];

      // make sure we have enough data
      if (!this.stream.available((point.position - this.stream.offset) + 32)) {
        return false;
      }

      // jump to the title offset
      this.stream.seek(point.position);

      // read the length of the title string
      const len = this.stream.readUInt16();
      let title = null;

      if (!this.stream.available(len)) {
        return false;
      }

      // if there is a BOM marker, read a utf16 string
      if (len > 2) {
        const bom = this.stream.peekUInt16();
        if ([0xfeff, 0xfffe].includes(bom)) {
          title = this.stream.readString(len, 'utf16-bom');
        }
      }

      // otherwise, use utf8
      if (title == null) {
        title = this.stream.readString(len, 'utf8');
      }

      // add the chapter title, timestamp, and duration
      let left;
      if (track.seekPoints[this.chapters.length + 1] && track.seekPoints[this.chapters.length + 1].timestamp) {
        left = track.seekPoints[this.chapters.length + 1].timestamp;
      }
      const nextTimestamp = left != null ? left : track.duration;
      this.chapters.push({
        title,
        timestamp: ((point.timestamp / track.timeScale) * 1000) | 0,
        duration: (((nextTimestamp - point.timestamp) / track.timeScale) * 1000) | 0,
      });
    }

    // we're done, so emit the chapter data
    this.emit('chapters', this.chapters);
    return true;
  }
}

AVDemuxer.register(M4ADemuxer);
