import AVEventEmitter from '../../core/events';
import AVBuffer from '../../core/buffer';

export default class AVFileSource extends AVEventEmitter {
  constructor(file) {
    super();

    this.file = file;
    if (typeof FileReader === 'undefined' || FileReader === null) {
      this.emit('error', 'This browser does not have FileReader support.');
      return;
    }

    this.offset = 0;
    this.length = this.file.size;
    this.chunkSize = 1 << 20;
  }

  start() {
    if (this.reader) {
      if (!this.active) { return this.loop(); }
    }

    this.reader = new FileReader();
    this.active = true;

    this.reader.onload = (e) => {
      const buf = new AVBuffer(new Uint8Array(e.target.result));
      this.offset += buf.length;

      this.emit('data', buf);
      this.active = false;
      if (this.offset < this.length) {
        this.loop();
      }
    };

    this.reader.onloadend = () => {
      if (this.offset === this.length) {
        this.emit('end');
        this.reader = null;
      }
    };

    this.reader.onerror = e => this.emit('error', e);

    this.reader.onprogress = e => this.emit('progress', ((this.offset + e.loaded) / this.length) * 100);

    return this.loop();
  }

  loop() {
    this.active = true;
    const endPos = Math.min(this.offset + this.chunkSize, this.length);

    const blob = this.file.slice(this.offset, endPos);
    return this.reader.readAsArrayBuffer(blob);
  }

  pause() {
    this.active = false;
    if (this.reader) {
      this.reader.abort();
    }
  }

  reset() {
    this.pause();
    this.offset = 0;
  }
}
