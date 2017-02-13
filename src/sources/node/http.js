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
  }

  start() {
    if (this.response != null) {
      return this.response.resume();
    }

    this.request = http.get(this.url);
    this.request.on('response', (response) => {
      this.response = response;
      if (this.response.statusCode !== 200) {
        return this.errorHandler(`Error loading file. HTTP status code ${this.response.statusCode}`);
      }

      this.size = parseInt(this.response.headers['content-length'], 10);
      this.loaded = 0;

      this.response.on('data', (chunk) => {
        this.loaded += chunk.length;
        this.emit('progress', (this.loaded / this.size) * 100);
        return this.emit('data', new AVBuffer(new Uint8Array(chunk)));
      }
            );

      this.response.on('end', () => this.emit('end')
            );

      return this.response.on('error', this.errorHandler);
    }
        );

    return this.request.on('error', this.errorHandler);
  }

  pause() {
    if (this.response) {
      this.response.pause();
    }
  }

  reset() {
    this.pause();
    this.request.abort();
    this.request = null;
    this.response = null;
  }

  errorHandler(err) {
    this.reset();
    this.emit('error', err);
  }
}
