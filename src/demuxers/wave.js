import AVDemuxer from '../demuxer';

export default class WAVEDemuxer extends AVDemuxer {
  constructor(source, chunk) {
    super(source, chunk);

    this.wave_formats = {
      // 0x0000:      // Unknown
      0x0001: 'lpcm', // Pulse Code Modulation (PCM) / Uncompressed
      // 0x0002:      // Microsoft ADPCM
      0x0003: 'lpcm', // Unknown
      0x0006: 'alaw', // ITU G.711 a-law
      0x0007: 'ulaw', // ITU G.711 µ-law
      // 0x0011:      // IMA ADPCM
      // 0x0016:      // ITU G.723 ADPCM (Yamaha)
      // 0x0031:      // GSM 6.10
      // 0x0040:      // ITU G.721 ADPCM
      // 0x0050:      // MPEG
    };
  }

  static probe(buffer) {
    return (buffer.peekString(0, 4) === 'RIFF') && (buffer.peekString(8, 4) === 'WAVE');
  }

  readChunk() {
    if (!this.readStart && this.stream.available(12)) {
      if (this.stream.readString(4) !== 'RIFF') {
        this.emit('error', 'Invalid WAV file (No RIFF).');
        return;
      }

      this.fileSize = this.stream.readUInt32(true);
      this.readStart = true;

      if (this.stream.readString(4) !== 'WAVE') {
        this.emit('error', 'Invalid WAV file (No WAVE).');
        return;
      }
    }

    while (this.stream.available(1)) {
      if (!this.readHeaders && this.stream.available(8)) {
        this.type = this.stream.readString(4);
        this.len = this.stream.readUInt32(true); // little endian
      }

      switch (this.type) {
        case 'fmt ': {
          const encoding = this.stream.readUInt16(true);
          if (this.wave_formats[encoding] == null) {
            this.emit('error', `Unsupported format in WAV file. (${encoding})`);
            return;
          }

          this.format = {
            formatID: this.wave_formats[encoding],
            floatingPoint: encoding === 0x0003,
            littleEndian: this.wave_formats[encoding] === 'lpcm',
            channelsPerFrame: this.stream.readUInt16(true),
            sampleRate: this.stream.readUInt32(true),
            framesPerPacket: 1,
          };

          this.stream.advance(4); // bytes/sec.
          this.stream.advance(2); // block align

          this.format.bitsPerChannel = this.stream.readUInt16(true);
          this.format.bytesPerPacket = (this.format.bitsPerChannel / 8) * this.format.channelsPerFrame;

          this.emit('format', this.format);

          // Advance to the next chunk
          this.stream.advance(this.len - 16);
          break;
        }
        case 'data': {
          if (!this.sentDuration) {
            const bytes = this.format.bitsPerChannel / 8;
            this.emit('duration', ((this.len / bytes / this.format.channelsPerFrame / this.format.sampleRate) * 1000) | 0);
            this.sentDuration = true;
          }

          const buffer = this.stream.readSingleBuffer(this.len);
          this.len -= buffer.length;
          this.readHeaders = this.len > 0;
          this.emit('data', buffer);
          break;
        }
        default: {
          if (!this.stream.available(this.len)) {
            return;
          }
          this.stream.advance(this.len);
        }
      }

      if (this.type !== 'data') {
        this.readHeaders = false;
      }
    }
  }
}

AVDemuxer.register(WAVEDemuxer);
