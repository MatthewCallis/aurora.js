/* global Module */
import AVBufferList from './../core/bufferlist';
import AVStream from './../core/stream';
import AVDemuxer from '../demuxer';

class SPCDemuxer extends AVDemuxer {
  constructor(...args) {
    super(...args);

    this.readChunk = this.readChunk.bind(this);
  }

  init() {
    if (this.stream.available(8)) {
      const buffer = this.stream.list.first;
      const { length } = buffer;
      // console.log 'SPC Size:',length,'(JS)'
      // console.log buffer
      // Confirmed Recieved Correctly
      // 83 78 69 83 45 83 80 67 ...
      // 53 4E 45 53 2D 53 50 43 ...
      const fileBuffer = Module._malloc(length);
      Module.HEAPU8.set(buffer.data, fileBuffer);
      return Module.ccall('SpcJsInit', 'void', ['number', 'number'], [fileBuffer, length]);
    }
  }

  cleanString(string) {
    if (!string) { return null; }
    return String(string).trim().replace(/\0/g, '');
  }

  readChunk() {
    if (!this.readStart && this.stream.available(66048)) {
      if (this.stream.peekString(0, 33) !== 'SNES-SPC700 Sound File Data v0.30') {
        this.emit('error', 'Invalid SPC file.');
        return;
      }

      this.readStart = true;
    }

    // Format
    this.format = {
      bitsPerChannel: 16,
      bytesPerPacket: 4,
      channelsPerFrame: 2,
      floatingPoint: false,
      formatID: 'spc7',
      framesPerPacket: 1,
      littleEndian: false,
      sampleRate: 32000,
    };

    this.emit('format', this.format);

    // Meta Data
    this.metadata = {
      songTitle: this.cleanString(this.stream.peekString(46, 32)), // 2Eh
      gameTitle: this.cleanString(this.stream.peekString(78, 32)), // 4Eh
      dumper: this.cleanString(this.stream.peekString(110, 16)), // 6Eh
      comments: this.cleanString(this.stream.peekString(126, 32)), // 7Eh
      dumpDate: this.cleanString(this.stream.peekString(158, 11)), // 9Eh
      artist: this.cleanString(this.stream.peekString(177, 32)), // B1h
    };

    // Check for ID666 Tag
    if ((this.stream.list.availableBytes > (66048 + 4)) && (this.stream.peekString(66048, 4) === 'xid6')) {
      // ID666 Avaliable
      const id666_length = this.stream.peekUInt32(66052, true);
      let bytes_readin = 4;
      if ((this.stream.list.availableBytes >= (66048 + 4 + id666_length)) && (bytes_readin < id666_length)) {
        let offset = 66056;
        const align = 4;
        // Read Sub-Chunks
        while ((offset < this.stream.list.availableBytes) && (bytes_readin < id666_length)) {
          let sub_chunk_data;
          let sub_chunk_raw;
          const sub_chunk_id = this.stream.peekUInt8(offset);
          const sub_chunk_type = this.stream.peekUInt8(offset + 1);
          bytes_readin += 2;
          if (sub_chunk_type === 1) {
            const sub_chunk_length = this.stream.peekUInt16(offset + 2, true);
            sub_chunk_data = this.stream.peekString(offset + 3, sub_chunk_length);
            offset += ((4 + sub_chunk_length) - 1);
            bytes_readin += (2 + sub_chunk_length);
          } else if (sub_chunk_type === 0) {
            sub_chunk_data = this.stream.peekUInt16(offset + 2, true);
            const list = new AVBufferList();
            list.append(this.stream.peekSingleBuffer(offset + 2, 2));
            sub_chunk_raw = new AVStream(list);
            offset += 4;
            bytes_readin += 2;
          } else if (sub_chunk_type === 4) {
            sub_chunk_data = this.stream.peekUInt32(offset + 4, true);
            offset += 8;
            bytes_readin += 6;
          }

          const offset_old = offset;
          offset = ((offset + align) - 1) & ~(align - 1); // Align on 32bit boundries

          // With garbage at the end of the file, this *should* work, see '3nkb-01.spc'
          bytes_readin += offset - offset_old;

          switch (sub_chunk_id) {
            case 1: this.metadata.songName = this.cleanString(sub_chunk_data); break;
            case 2: this.metadata.gameName = this.cleanString(sub_chunk_data); break;
            case 3: this.metadata.artistName = this.cleanString(sub_chunk_data); break;
            case 4: this.metadata.dumperName = this.cleanString(sub_chunk_data); break;
            case 5: this.metadata.dateDumped = this.cleanString(sub_chunk_data); break;
            case 6:
              if (sub_chunk_data === 0) {
                this.metadata.emulatorUsed = 'ZSNES';
              } else if (sub_chunk_data === 1) {
                this.metadata.emulatorUsed = 'ZSNES';
              } else {
                this.metadata.emulatorUsed = `Unknown Emulator (${sub_chunk_data})`;
              }
              break;
            case 7: this.metadata.comments = this.cleanString(sub_chunk_data); break;
            case 16: this.metadata.ost = this.cleanString(sub_chunk_data); break; // Official Soundtrack Title
            case 17: this.metadata.ostDisc = this.cleanString(sub_chunk_data); break;
            case 18:
              // Upper byte is the number 0-99, lower byte is an optional ASCII character.
              this.metadata.ostTrack = sub_chunk_raw.peekUInt8(1) + String.fromCharCode(sub_chunk_raw.peekUInt8(0));
              break;
            case 19: this.metadata.publisherName = this.cleanString(sub_chunk_data); break;
            case 20: this.metadata.copyrightYear = this.cleanString(sub_chunk_data); break;
            // Lengths are stored in ticks.
            // A tick is 1/64000th of a second.
            // The maximum length is 383999999 ticks.
            // The End can contain a negative value.
            case 48: this.metadata.introLength = sub_chunk_data; break; // Introduction length
            case 49: this.metadata.loopLength = sub_chunk_data; break;
            case 50: this.metadata.endLength = sub_chunk_data; break;
            case 51: this.metadata.fadeLength = sub_chunk_data; break;
            // A bit is set for each channel that's muted.
            case 52: this.metadata.mutedChannels = sub_chunk_data; break;
            // Number of times to loop the loop section of the song
            case 53: this.metadata.loopCount = sub_chunk_data; break;
            // Amplification value to apply to output (65536 = Normal SNES)
            case 54: this.metadata.amplification = sub_chunk_data; break;
            default:
              this.metadata[`unknown_${sub_chunk_id}_type_${sub_chunk_type}`] = sub_chunk_data;
          }
        }
      }
    }

    this.emit('metadata', this.metadata);

    // Duration
    const duration = parseInt(this.stream.peekString(169, 3), 10) * 1000; // A9h, seconds
    const fadeOut = parseInt(this.stream.peekString(172, 3), 10);        // ACh, ms
    this.seconds = parseInt(duration + fadeOut, 10);
    this.emit('duration', this.seconds);

    // Send Data to Demuxer
    while (this.stream.available(1)) {
      const buf = this.stream.readSingleBuffer(this.stream.remainingBytes());
      this.emit('data', buf);
    }
  }

  static probe(buffer) {
    return buffer.peekString(0, 33) === 'SNES-SPC700 Sound File Data v0.30';
  }
}

AVDemuxer.register(SPCDemuxer);
