import AVEventEmitter from './core/events';
import AVBufferList from './core/bufferlist';
import AVStream from './core/stream';

export default class AVDemuxer extends AVEventEmitter {
  constructor(source, chunk) {
    super();

    const list = new AVBufferList();
    list.append(chunk);
    this.stream = new AVStream(list);

    let received = false;
    source.on('data', (data_chunk) => {
      received = true;
      list.append(data_chunk);
      this.readChunk(data_chunk);
    });

    source.on('error', (err) => {
      this.emit('error', err);
    });

    source.on('end', () => {
      // if there was only one chunk received, read it
      if (!received) {
        this.readChunk(chunk);
      }
      this.emit('end');
    });

    this.seekPoints = [];
    this.init();
  }

  init() {}

  readChunk(chunk) {}

  addSeekPoint(offset, timestamp) {
    const index = this.searchTimestamp(timestamp);
    this.seekPoints.splice(index, 0, { offset, timestamp });
  }

  searchTimestamp(timestamp, backward) {
    let low = 0;
    let high = this.seekPoints.length;

    // optimize appending entries
    if ((high > 0) && (this.seekPoints[high - 1].timestamp < timestamp)) {
      return high;
    }

    while (low < high) {
      const mid = (low + high) >> 1;
      const time = this.seekPoints[mid].timestamp;

      if (time < timestamp) {
        low = mid + 1;
      } else if (time >= timestamp) {
        high = mid;
      }
    }

    if (high > this.seekPoints.length) {
      high = this.seekPoints.length;
    }

    return high;
  }

  seek(timestamp) {
    if (this.format && (this.format.framesPerPacket > 0) && (this.format.bytesPerPacket > 0)) {
      const seekPoint = {
        timestamp,
        offset: (this.format.bytesPerPacket * timestamp) / this.format.framesPerPacket,
      };

      return seekPoint;
    }
    const index = this.searchTimestamp(timestamp);
    return this.seekPoints[index];
  }
  static register(demuxer) {
    return AVDemuxer.formats.push(demuxer);
  }

  static find(buffer) {
    const stream = AVStream.fromBuffer(buffer);
    for (const format of Array.from(AVDemuxer.formats)) {
      if (format.probe(stream)) {
        return format;
      }
    }

    return null;
  }

  static probe() {
    return false;
  }
}

AVDemuxer.formats = [];
