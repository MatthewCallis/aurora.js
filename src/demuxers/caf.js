import AVDemuxer from '../demuxer';
import M4ADemuxer from './m4a';

export default class CAFDemuxer extends AVDemuxer {
  // https://developer.apple.com/library/content/qa/qa1534/_index.html
  // https://developer.apple.com/library/content/documentation/MusicAudio/Reference/CAFSpec/CAF_spec/CAF_spec.html
  // kAudioFormatLinearPCM      = 'lpcm',
  // kAudioFormatAppleIMA4      = 'ima4',
  // kAudioFormatMPEG4AAC       = 'aac ',
  // kAudioFormatMACE3          = 'MAC3',
  // kAudioFormatMACE6          = 'MAC6',
  // kAudioFormatULaw           = 'ulaw',
  // kAudioFormatALaw           = 'alaw',
  // kAudioFormatMPEGLayer1     = '.mp1',
  // kAudioFormatMPEGLayer2     = '.mp2',
  // kAudioFormatMPEGLayer3     = '.mp3',
  // kAudioFormatAppleLossless  = 'alac'

  static probe(buffer) {
    return buffer.peekString(0, 4) === 'caff';
  }

  readChunk() {
    if (!this.format && this.stream.available(64)) { // Number out of my behind
      if (this.stream.readString(4) !== 'caff') {
        this.emit('error', "Invalid CAF, does not begin with 'caff'");
        return;
      }

      // skip version and flags
      this.stream.advance(4);

      if (this.stream.readString(4) !== 'desc') {
        this.emit('error', "Invalid CAF, 'caff' is not followed by 'desc'");
        return;
      }

      if ((this.stream.readUInt32() !== 0) || (this.stream.readUInt32() !== 32)) {
        this.emit('error', "Invalid 'desc' size, should be 32");
        return;
      }

      this.format = {};
      this.format.sampleRate = this.stream.readFloat64();
      this.format.formatID = this.stream.readString(4);

      const flags = this.stream.readUInt32();
      if (this.format.formatID === 'lpcm') {
        this.format.floatingPoint = Boolean(flags & 1);
        this.format.littleEndian = Boolean(flags & 2);
      }

      this.format.bytesPerPacket = this.stream.readUInt32();
      this.format.framesPerPacket = this.stream.readUInt32();
      this.format.channelsPerFrame = this.stream.readUInt32();
      this.format.bitsPerChannel = this.stream.readUInt32();

      this.emit('format', this.format);
    }

    while (this.stream.available(1)) {
      let buffer;

      if (!this.headerCache) {
        this.headerCache = {
          type: this.stream.readString(4),
          oversize: this.stream.readUInt32() !== 0,
          size: this.stream.readUInt32(),
        };

        if (this.headerCache.oversize) {
          this.emit('error', 'Holy Shit, an oversized file, not supported in JS');
          return;
        }
      }

      switch (this.headerCache.type) {
        case 'kuki': {
          if (this.stream.available(this.headerCache.size)) {
            if (this.format.formatID === 'aac ') { // variations needed?
              const offset = this.stream.offset + this.headerCache.size;
              const cookie = M4ADemuxer.readEsds(this.stream);
              if (cookie) {
                this.emit('cookie', cookie);
              }
              this.stream.seek(offset); // skip extra garbage
            } else {
              buffer = this.stream.readBuffer(this.headerCache.size);
              this.emit('cookie', buffer);
            }

            this.headerCache = null;
          }
          break;
        }
        case 'pakt': {
          /* istanbul ignore else */
          if (this.stream.available(this.headerCache.size)) {
            if (this.stream.readUInt32() !== 0) {
              this.emit('error', 'Sizes greater than 32 bits are not supported.');
              return;
            }

            this.numPackets = this.stream.readUInt32();

            if (this.stream.readUInt32() !== 0) {
              this.emit('error', 'Sizes greater than 32 bits are not supported.');
              return;
            }

            this.numFrames = this.stream.readUInt32();
            this.primingFrames = this.stream.readUInt32();
            this.remainderFrames = this.stream.readUInt32();

            this.emit('duration', ((this.numFrames / this.format.sampleRate) * 1000) | 0);
            this.sentDuration = true;

            let byteOffset = 0;
            let sampleOffset = 0;
            for (let i = 0; i < this.numPackets; i++) {
              this.addSeekPoint(byteOffset, sampleOffset);
              byteOffset += this.format.bytesPerPacket || /* istanbul ignore next */ M4ADemuxer.readDescrLen(this.stream);
              sampleOffset += this.format.framesPerPacket || /* istanbul ignore next */ M4ADemuxer.readDescrLen(this.stream);
            }

            this.headerCache = null;
          }
          break;
        }
        // TODO: Haven't found a file with this type.
        /* istanbul ignore next */
        case 'info': {
          const entries = this.stream.readUInt32();
          const metadata = {};

          for (let i = 0, asc = entries >= 0; asc ? i < entries : i > entries; asc ? i++ : i--) {
            // null terminated strings
            const key = this.stream.readString(null);
            const value = this.stream.readString(null);
            metadata[key] = value;
          }

          this.emit('metadata', metadata);
          this.headerCache = null;
          break;
        }
        case 'data': {
          if (!this.sentFirstDataChunk) {
            // skip edit count
            this.stream.advance(4);
            this.headerCache.size -= 4;

            // calculate the duration based on bytes per packet if no packet table
            if ((this.format.bytesPerPacket !== 0) && !this.sentDuration) {
              this.numFrames = this.headerCache.size / this.format.bytesPerPacket;
              this.emit('duration', ((this.numFrames / this.format.sampleRate) * 1000) | 0);
            }

            this.sentFirstDataChunk = true;
          }

          buffer = this.stream.readSingleBuffer(this.headerCache.size);
          this.headerCache.size -= buffer.length;
          this.emit('data', buffer);

          if (this.headerCache.size <= 0) {
            this.headerCache = null;
          }
          break;
        }
        default: {
          /* istanbul ignore else */
          if (this.stream.available(this.headerCache.size)) {
            this.stream.advance(this.headerCache.size);
            this.headerCache = null;
          }
        }
      }
    }
  }
}

AVDemuxer.register(CAFDemuxer);
