import AVEventEmitter from '../../core/events';
import AVBuffer from '../../core/buffer';

export default class AVHTTPSource extends AVEventEmitter {
  constructor(url) {
    super();

    this.url = url;
    this.chunkSize = 1 << 20;
    this.inflight = false;
    this.reset();
  }

  start() {
    if (this.length) {
      if (!this.inflight) {
        return this.loop();
      }
    }

    this.inflight = true;
    this.xhr = new XMLHttpRequest();

    this.xhr.onload = () => {
      this.length = parseInt(this.xhr.getResponseHeader('Content-Length'), 10);
      this.inflight = false;
      return this.loop();
    };

    this.xhr.onerror = (err) => {
      this.pause();
      return this.emit('error', err);
    };

    this.xhr.onabort = () => {
      this.inflight = false;
    };

    this.xhr.open('HEAD', this.url, true);
    return this.xhr.send(null);
  }

  loop() {
    if (this.inflight || !this.length) {
      return this.emit('error', 'Something is wrong in HTTPSource.loop');
    }

    this.inflight = true;
    this.xhr = new XMLHttpRequest();

    this.xhr.onload = () => {
      let buf;
      if (this.xhr.response) {
        buf = new Uint8Array(this.xhr.response);
      } else {
        const txt = this.xhr.responseText;
        buf = new Uint8Array(txt.length);
        for (let i = 0, end = txt.length, asc = end >= 0; asc ? i < end : i > end; asc ? i++ : i--) {
          buf[i] = txt.charCodeAt(i) & 0xff;
        }
      }

      const buffer = new AVBuffer(buf);
      this.offset += buffer.length;

      this.emit('data', buffer);
      if (this.offset >= this.length) { this.emit('end'); }

      this.inflight = false;
      if (this.offset < this.length) {
        this.loop();
      }
    };

    this.xhr.onprogress = event => this.emit('progress', ((this.offset + event.loaded) / this.length) * 100);

    this.xhr.onerror = (err) => {
      this.emit('error', err);
      return this.pause();
    };

    this.xhr.onabort = () => {
      this.inflight = false;
    };

    this.xhr.open('GET', this.url, true);
    this.xhr.responseType = 'arraybuffer';

    const endPos = Math.min(this.offset + this.chunkSize, this.length);
    this.xhr.setRequestHeader('Range', `bytes=${this.offset}-${endPos}`);
    this.xhr.overrideMimeType('text/plain; charset=x-user-defined');
    return this.xhr.send(null);
  }

  pause() {
    this.inflight = false;
    if (this.xhr) {
      this.xhr.abort();
    }
  }

  reset() {
    this.pause();
    this.offset = 0;
  }
}
