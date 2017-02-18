import AVDecoder from '../decoder';

export default class LPCMDecoder extends AVDecoder {
  constructor(demuxer, format) {
    super(demuxer, format);

    this.readChunk = this.readChunk.bind(this);
  }

  readChunk() {
    let output;
    const { stream } = this;
    const { littleEndian } = this.format;
    const chunkSize = Math.min(4096, stream.remainingBytes());
    const samples = (chunkSize / (this.format.bitsPerChannel / 8)) | 0;

    if (chunkSize < (this.format.bitsPerChannel / 8)) {
      return null;
    }

    if (this.format.floatingPoint) {
      switch (this.format.bitsPerChannel) {
        case 32: {
          output = new Float32Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream.readFloat32(littleEndian);
          }
          break;
        }
        case 64: {
          output = new Float64Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream.readFloat64(littleEndian);
          }
          break;
        }
        default: {
          this.emit('error', `Unsupported bit depth. (${this.format.bitsPerChannel})`);
          return null;
        }
      }
    } else {
      switch (this.format.bitsPerChannel) {
        case 8: {
          output = new Int8Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream.readInt8();
          }
          break;
        }
        case 16: {
          output = new Int16Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream.readInt16(littleEndian);
          }
          break;
        }
        case 24: {
          output = new Int32Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream.readInt24(littleEndian);
          }
          break;
        }
        case 32: {
          output = new Int32Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream.readInt32(littleEndian);
          }
          break;
        }
        default: {
          this.emit('error', `Unsupported bit depth. (${this.format.bitsPerChannel})`);
          return null;
        }
      }
    }

    return output;
  }
}

AVDecoder.register('lpcm', LPCMDecoder);
