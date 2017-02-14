import AVEventEmitter from './core/events';
import AVBufferList from './core/bufferlist';
import AVStream from './core/stream';
import AVBitstream from './core/bitstream';
import AVUnderflowError from './core/underflow_error';

export default class AVDecoder extends AVEventEmitter {
  constructor(demuxer, format) {
    super();

    this.demuxer = demuxer;
    this.format = format;
    const list = new AVBufferList();
    this.stream = new AVStream(list);
    this.bitstream = new AVBitstream(this.stream);

    this.receivedFinalBuffer = false;
    this.waiting = false;

    this.demuxer.on('cookie', (cookie) => {
      try {
        return this.setCookie(cookie);
      } catch (error) {
        return this.emit('error', error);
      }
    }
        );

    this.demuxer.on('data', (chunk) => {
      list.append(chunk);
      if (this.waiting) {
        this.decode();
      }
    });

    this.demuxer.on('end', () => {
      this.receivedFinalBuffer = true;
      if (this.waiting) {
        this.decode();
      }
    });

    this.init();
  }

  init() {}

  setCookie(cookie) {}

  readChunk() {}

  decode() {
    let packet;
    this.waiting = false;
    const offset = this.bitstream.offset();

    try {
      packet = this.readChunk();
    } catch (error) {
      if (!(error instanceof AVUnderflowError)) {
        this.emit('error', error);
        return false;
      }
    }

        // if a packet was successfully read, emit it
    if (packet) {
      this.emit('data', packet);
      return true;

        // if we haven't reached the end, jump back and try again when we have more data
    } else if (!this.receivedFinalBuffer) {
      this.bitstream.seek(offset);
      this.waiting = true;

        // otherwise we've reached the end
    } else {
      this.emit('end');
    }

    return false;
  }

  seek(timestamp) {
    // use the demuxer to get a seek point
    const seekPoint = this.demuxer.seek(timestamp);
    this.stream.seek(seekPoint.offset);
    return seekPoint.timestamp;
  }

  static register(id, decoder) {
    AVDecoder.codecs[id] = decoder;
    return AVDecoder.codecs;
  }

  static find(id) {
    return AVDecoder.codecs[id] || null;
  }

  get codecs() {
    return AVDecoder.codecs;
  }
}

AVDecoder.codecs = [];
