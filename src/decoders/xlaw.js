import AVDecoder from '../decoder';

export default class XLAWDecoder extends AVDecoder {
  constructor(demuxer, format) {
    super(demuxer, format);

    this.readChunk = this.readChunk.bind(this);
  }

  init() {
    this.SIGN_BIT = 0x80;
    this.QUANT_MASK = 0xf;
    this.SEG_SHIFT = 4;
    this.SEG_MASK = 0x70;
    this.BIAS = 0x84;

    this.format.bitsPerChannel = 16;
    this.table = new Int16Array(256);

    if (this.format.formatID === 'ulaw') {
      for (let i = 0; i < 256; i++) {
        // Complement to obtain normal u-law value.
        const val = ~i;

        // Extract and bias the quantization bits. Then
        // shift up by the segment number and subtract out the bias.
        let t = ((val & this.QUANT_MASK) << 3) + this.BIAS;
        t <<= (val & this.SEG_MASK) >>> this.SEG_SHIFT;

        this.table[i] = val & this.SIGN_BIT ? this.BIAS - t : t - this.BIAS;
      }
    } else {
      for (let i = 0; i < 256; i++) {
        const val = i ^ 0x55;
        let t = val & this.QUANT_MASK;
        const seg = (val & this.SEG_MASK) >>> this.SEG_SHIFT;

        if (seg) {
          t = (t + t + 1 + 32) << (seg + 2);
        } else {
          t = (t + t + 1) << 3;
        }

        this.table[i] = val & this.SIGN_BIT ? t : -t;
      }
    }
  }

  readChunk() {
    const { stream, table } = this;

    const samples = Math.min(4096, stream.remainingBytes());
    if (samples === 0) {
      return null;
    }

    const output = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      output[i] = table[stream.readUInt8()];
    }

    return output;
  }
}

AVDecoder.register('ulaw', XLAWDecoder);
AVDecoder.register('alaw', XLAWDecoder);
