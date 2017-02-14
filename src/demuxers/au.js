import AVDemuxer from '../demuxer';

export default class AUDemuxer extends AVDemuxer {
  constructor(source, chunk) {
    super(source, chunk);

    this.bps = [
      null, //  0: N/A
      8,    //  1: 8-bit G.711 µ-law
      8,    //  2: 8-bit linear PCM
      16,   //  3: 16-bit linear PCM
      24,   //  4: 24-bit linear PCM
      32,   //  5: 32-bit linear PCM
      32,   //  6: 32-bit IEEE floating point
      64,   //  7: 64-bit IEEE floating point
      null, //  8: Fragmented sample data
      null, //  9: DSP program
      null, // 10: 8-bit fixed point
      null, // 11: 16-bit fixed point
      null, // 12: 24-bit fixed point
      null, // 13: 32-bit fixed point
      null, // 14: N/A
      null, // 15: N/A
      null, // 16: N/A
      null, // 17: N/A
      null, // 18: 16-bit linear with emphasis
      null, // 19: 16-bit linear compressed
      null, // 20: 16-bit linear with emphasis and compression
      null, // 21: Music kit DSP commands
      null, // 22: N/A
      null, // 23: 4-bit compressed using the ITU-T G.721 ADPCM voice data encoding scheme
      null, // 24: ITU-T G.722 SB-ADPCM
      null, // 25: ITU-T G.723 3-bit ADPCM
      null, // 26: ITU-T G.723 5-bit ADPCM
      8,    // 27: 8-bit G.711 A-law
    ];

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
        this.emit('error', 'Invalid AU file.');
        return;
      }

      const dataOffset = this.stream.readUInt32();
      const dataSize = this.stream.readUInt32();
      const encoding = this.stream.readUInt32();

      this.format = {
        formatID: this.au_formats[encoding] || 'lpcm',
        littleEndian: false,
        floatingPoint: [6, 7].includes(encoding),
        bitsPerChannel: this.bps[encoding],
        sampleRate: this.stream.readUInt32(),
        channelsPerFrame: this.stream.readUInt32(),
        framesPerPacket: 1,
        dataOffset,
      };

      if (this.format.bitsPerChannel == null) {
        this.emit('error', 'Unsupported encoding in AU file.');
        return;
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
