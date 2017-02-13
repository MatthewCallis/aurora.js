import AVDemuxer from '../demuxer';

export default class AUDemuxer extends AVDemuxer {
  constructor(source, chunk) {
    super(source, chunk);

    this.bps = [8, 8, 16, 24, 32, 32, 64];
    this.bps[26] = 8;

    this.au_formats = {
      1: 'ulaw',
      27: 'alaw',
    };
  }

  static probe(buffer) {
    return buffer.peekString(0, 4) === '.snd';
  }

  readChunk() {
    if (!this.readHeader && this.stream.available(24)) {
      if (this.stream.readString(4) !== '.snd') {
        return this.emit('error', 'Invalid AU file.');
      }

      const size = this.stream.readUInt32();
      const dataSize = this.stream.readUInt32();
      const encoding = this.stream.readUInt32();

      this.format = {
        formatID: this.au_formats[encoding] || 'lpcm',
        littleEndian: false,
        floatingPoint: [6, 7].includes(encoding),
        bitsPerChannel: this.bps[encoding - 1],
        sampleRate: this.stream.readUInt32(),
        channelsPerFrame: this.stream.readUInt32(),
        framesPerPacket: 1,
      };

      if (this.format.bitsPerChannel == null) {
        return this.emit('error', 'Unsupported encoding in AU file.');
      }

      this.format.bytesPerPacket = (this.format.bitsPerChannel / 8) * this.format.channelsPerFrame;

      if (dataSize !== 0xffffffff) {
        const bytes = this.format.bitsPerChannel / 8;
        this.emit('duration', ((dataSize / bytes / this.format.channelsPerFrame / this.format.sampleRate) * 1000) | 0);
      }

      this.emit('format', this.format);
      this.readHeader = true;
    }

    if (this.readHeader) {
      while (this.stream.available(1)) {
        this.emit('data', this.stream.readSingleBuffer(this.stream.remainingBytes()));
      }
    }
  }
}

AVDemuxer.register(AUDemuxer);
