import http from 'http';
import AVEventEmitter from '../../core/events';
import AVBuffer from '../../core/buffer';

export default class AVHTTPSource extends AVEventEmitter {
  constructor(url) {
    super();

    this.errorHandler = this.errorHandler.bind(this);
    this.url = url;
    this.request = null;
    this.response = null;

    this.loaded = 0;
    this.size = 0;

    this.paused = true;
  }

  start() {
    this.paused = false;

    if (this.response != null) {
      this.response.resume();
      return;
    }

    this.request = http.get(this.url);
    this.request.on('response', (response) => {
      this.response = response;
      if (this.response.statusCode !== 200) {
        this.errorHandler(`Error loading file. HTTP status code ${this.response.statusCode}`);
        return;
      }

      this.size = parseInt(this.response.headers['content-length'], 10);
      this.loaded = 0;

      this.response.on('data', (chunk) => {
        this.loaded += chunk.length;
        this.emit('progress', (this.loaded / this.size) * 100);
        this.emit('data', new AVBuffer(new Uint8Array(chunk)));
      });

      this.response.on('end', () => {
        this.emit('end');
      });

      this.response.on('error', this.errorHandler);
    });

    this.request.on('error', this.errorHandler);
  }

  pause() {
    if (this.response) {
      this.response.pause();
      this.paused = true;
    }
  }

  reset() {
    this.pause();
    this.request.abort();
    this.request = null;
    this.response = null;
  }

  errorHandler(error) {
    this.reset();
    this.emit('error', error);
  }
}
