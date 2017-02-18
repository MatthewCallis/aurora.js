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
      /* istanbul ignore next */
      try {
        this.setCookie(cookie);
      } catch (error) {
        this.emit('error', error);
      }
    });

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

  setCookie() {}

  readChunk() {}

  decode() {
    let packet;
    this.waiting = false;
    const offset = this.bitstream.offset();

    try {
      packet = this.readChunk();
    } catch (error) {
      /* istanbul ignore else */
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

  // TODO: Nothing implements seeking.
  seek(timestamp) {
    // use the demuxer to get a seek point
    /* istanbul ignore next */
    const seekPoint = this.demuxer.seek(timestamp);
    /* istanbul ignore next */
    this.stream.seek(seekPoint.offset);
    /* istanbul ignore next */
    return seekPoint.timestamp;
  }

  static register(id, decoder) {
    AVDecoder.codecs[id] = decoder;
    return AVDecoder.codecs;
  }

  static find(id) {
    return AVDecoder.codecs[id] || null;
  }
}

AVDecoder.codecs = {};
