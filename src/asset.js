// The Asset class is responsible for managing all aspects of the
// decoding pipeline from source to decoder.  You can use the Asset
// class to inspect information about an audio file, such as its
// format, metadata, and duration, as well as actually decode the
// file to linear PCM raw audio data.

/* global AVHTTPSource, AVFileSource */

import AVEventEmitter from './core/events';
import AVBufferSource from './sources/buffer';
import AVDemuxer from './demuxer';
import AVDecoder from './decoder';

export default class AVAsset extends AVEventEmitter {
  constructor(source) {
    super();

    this.probe = this.probe.bind(this);
    this.findDecoder = this.findDecoder.bind(this);
    this._decode = this._decode.bind(this);
    this.source = source;
    this.buffered = 0;
    this.duration = null;
    this.format = null;
    this.metadata = null;
    this.active = false;
    this.demuxer = null;
    this.decoder = null;

    this.source.once('data', this.probe);
    this.source.on('error', (err) => {
      this.emit('error', err);
      this.stop();
    });

    this.source.on('progress', (buffered) => {
      this.buffered = buffered;
      this.emit('buffer', this.buffered);
    });
  }

  static fromURL(url) {
    return new AVAsset(new AVHTTPSource(url));
  }

  static fromFile(file) {
    return new AVAsset(new AVFileSource(file));
  }

  static fromBuffer(buffer) {
    return new AVAsset(new AVBufferSource(buffer));
  }

  start(decode) {
    if (this.active) { return; }

    if (decode != null) { this.shouldDecode = decode; }
    if (this.shouldDecode == null) { this.shouldDecode = true; }

    this.active = true;
    this.source.start();

    if (this.decoder && this.shouldDecode) {
      this._decode();
    }
  }

  stop() {
    if (!this.active) { return; }

    this.active = false;
    this.source.pause();
  }

  get(event, callback) {
    if (!['format', 'duration', 'metadata'].includes(event)) {
      return;
    }

    if (this[event] != null) {
      callback(this[event]);
    } else {
      this.once(event, (value) => {
        this.stop();
        return callback(value);
      });
      this.start();
    }
  }

  decodePacket() {
    return this.decoder.decode();
  }

  decodeToBuffer(callback) {
    let length = 0;
    const chunks = [];
    const dataHandler = (chunk) => {
      length += chunk.length;
      return chunks.push(chunk);
    };

    this.on('data', dataHandler);

    this.once('end', () => {
      const buf = new Float32Array(length);
      let offset = 0;

      for (const chunk of Array.from(chunks)) {
        buf.set(chunk, offset);
        offset += chunk.length;
      }

      this.off('data', dataHandler);
      callback(buf);
    });

    this.start();
  }

  probe(chunk) {
    if (!this.active) { return; }

    const Demuxer = AVDemuxer.find(chunk);
    if (!Demuxer) {
      this.emit('error', 'A demuxer for this container was not found.');
      return;
    }

    this.demuxer = new Demuxer(this.source, chunk);
    this.demuxer.on('format', this.findDecoder);

    this.demuxer.on('duration', (duration) => {
      this.duration = duration;
      this.emit('duration', this.duration);
    });

    this.demuxer.on('metadata', (metadata) => {
      this.metadata = metadata;
      this.emit('metadata', this.metadata);
    });

    this.demuxer.on('error', (err) => {
      this.emit('error', err);
      this.stop();
    });
  }

  findDecoder(format) {
    this.format = format;
    if (!this.active) {
      return;
    }

    this.emit('format', this.format);

    const Decoder = AVDecoder.find(this.format.formatID);
    if (!Decoder) {
      this.emit('error', `A decoder for ${this.format.formatID} was not found.`);
      return;
    }

    this.decoder = new Decoder(this.demuxer, this.format);

    if (this.format.floatingPoint) {
      this.decoder.on('data', buffer => this.emit('data', buffer));
    } else {
      const div = (this.format.bitsPerChannel - 1) ** 2;
      this.decoder.on('data', (buffer) => {
        const buf = new Float32Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
          const sample = buffer[i];
          buf[i] = sample / div;
        }

        this.emit('data', buf);
      });
    }

    this.decoder.on('error', (err) => {
      this.emit('error', err);
      this.stop();
    });

    this.decoder.on('end', () => this.emit('end'));

    this.emit('decodeStart');
    if (this.shouldDecode) {
      this._decode();
    }
  }

  _decode() {
    while (this.decoder.decode() && this.active) {
      continue;
    }
    if (this.active) {
      this.decoder.once('data', this._decode);
    }
  }
}
