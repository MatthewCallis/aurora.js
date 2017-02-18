import http from 'http';
import fs from 'fs';
import Speaker from 'speaker';
import { Readable } from 'stream';

class AVBuffer {
  constructor(input) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
      this.data = Uint8Array.from(input);
    } else if (input instanceof Uint8Array) {
      // Uint8Array
      this.data = input;
    } else if (input instanceof ArrayBuffer || Array.isArray(input) || (typeof input === 'number')) {
      // ArrayBuffer || Normal JS Array || Number (i.e. length) || Node Buffer
      this.data = new Uint8Array(input);
    } else if (input.buffer instanceof ArrayBuffer) {
      // typed arrays other than Uint8Array
      this.data = new Uint8Array(input.buffer, input.byteOffset, input.length * input.BYTES_PER_ELEMENT);
    } else if (input instanceof AVBuffer) {
      // AVBuffer, make a shallow copy
      this.data = input.data;
    } else {
      throw new Error('Constructing buffer with unknown type.');
    }

    this.length = this.data.length;

    // used when the buffer is part of a bufferlist
    this.next = null;
    this.prev = null;
  }

  static allocate(size) {
    return new AVBuffer(size);
  }

  copy() {
    return new AVBuffer(new Uint8Array(this.data));
  }

  slice(position, length = this.length) {
    if ((position === 0) && (length >= this.length)) {
      return new AVBuffer(this.data);
    }
    return new AVBuffer(this.data.subarray(position, position + length));
  }

  static makeBlob(data, type = 'application/octet-stream') {
    return new Blob([data], { type });
  }

  static makeBlobURL(data, type) {
    return URL.createObjectURL(this.makeBlob(data, type));
  }

  static revokeBlobURL(url) {
    URL.revokeObjectURL(url);
  }

  toBlob() {
    return AVBuffer.makeBlob(this.data.buffer);
  }

  toBlobURL() {
    return AVBuffer.makeBlobURL(this.data.buffer);
  }
}

class AVBufferList {
  constructor() {
    this.first = null;
    this.last = null;
    this.numBuffers = 0;
    this.availableBytes = 0;
    this.availableBuffers = 0;
  }

  copy() {
    const result = new AVBufferList();

    result.first = this.first;
    result.last = this.last;
    result.numBuffers = this.numBuffers;
    result.availableBytes = this.availableBytes;
    result.availableBuffers = this.availableBuffers;

    return result;
  }

  append(buffer) {
    buffer.prev = this.last;
    if (this.last) {
      this.last.next = buffer;
    }
    this.last = buffer;
    if (this.first == null) {
      this.first = buffer;
    }

    this.availableBytes += buffer.length;
    this.availableBuffers++;
    return this.numBuffers++;
  }

  advance() {
    if (this.first) {
      this.availableBytes -= this.first.length;
      this.availableBuffers--;
      this.first = this.first.next;
      return (this.first != null);
    }

    return false;
  }

  rewind() {
    if (this.first && !this.first.prev) {
      return false;
    }

    this.first = this.first ? this.first.prev : this.last;
    if (this.first) {
      this.availableBytes += this.first.length;
      this.availableBuffers++;
    }

    return (this.first != null);
  }

  reset() {
    return (() => {
      const result = [];
      while (this.rewind()) {
        continue;
      }
      return result;
    })();
  }
}

class AVUnderflowError extends Error {
  constructor(message) {
    super(message);

    this.name = 'AVUnderflowError';
    this.stack = (new Error(message)).stack;
    /* istanbul ignore else */
    // https://nodejs.org/api/errors.html#errors_error_capturestacktrace_targetobject_constructoropt
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// define an error class to be thrown if an underflow occurs
class AVStream {
  constructor(list) {
    this.buf = new ArrayBuffer(16);
    this.uint8 = new Uint8Array(this.buf);
    this.int8 = new Int8Array(this.buf);
    this.uint16 = new Uint16Array(this.buf);
    this.int16 = new Int16Array(this.buf);
    this.uint32 = new Uint32Array(this.buf);
    this.int32 = new Int32Array(this.buf);
    this.float32 = new Float32Array(this.buf);
    this.float64 = new Float64Array(this.buf);

    // detect the native endianness of the machine
    // 0x3412 is little endian, 0x1234 is big endian
    this.nativeEndian = new Uint16Array(new Uint8Array([0x12, 0x34]).buffer)[0] === 0x3412;

    this.list = list;
    this.localOffset = 0;
    this.offset = 0;

    // this.decodeString = this.decodeString.bind(this);
  }

  static fromBuffer(buffer) {
    const list = new AVBufferList();
    list.append(buffer);
    return new AVStream(list);
  }

  copy() {
    const result = new AVStream(this.list.copy());
    result.localOffset = this.localOffset;
    result.offset = this.offset;
    return result;
  }

  available(bytes) {
    return bytes <= (this.list.availableBytes - this.localOffset);
  }

  remainingBytes() {
    return this.list.availableBytes - this.localOffset;
  }

  advance(bytes) {
    if (!this.available(bytes)) {
      throw new AVUnderflowError();
    }

    this.localOffset += bytes;
    this.offset += bytes;

    while (this.list.first && (this.localOffset >= this.list.first.length)) {
      this.localOffset -= this.list.first.length;
      this.list.advance();
    }

    return this;
  }

  rewind(bytes) {
    if (bytes > this.offset) {
      throw new AVUnderflowError();
    }

    // if we're at the end of the bufferlist, seek from the end
    if (!this.list.first) {
      this.list.rewind();
      this.localOffset = this.list.first.length;
    }

    this.localOffset -= bytes;
    this.offset -= bytes;

    while (this.list.first.prev && (this.localOffset < 0)) {
      this.list.rewind();
      this.localOffset += this.list.first.length;
    }

    return this;
  }

  seek(position) {
    let output = this;
    if (position > this.offset) {
      output = this.advance(position - this.offset);
    } else if (position < this.offset) {
      output = this.rewind(this.offset - position);
    }
    return output;
  }

  readUInt8() {
    if (!this.available(1)) {
      throw new AVUnderflowError();
    }

    const output = this.list.first.data[this.localOffset];
    this.localOffset += 1;
    this.offset += 1;

    if (this.localOffset === this.list.first.length) {
      this.localOffset = 0;
      this.list.advance();
    }

    return output;
  }

  peekUInt8(offset = 0) {
    if (!this.available(offset + 1)) {
      throw new AVUnderflowError();
    }

    offset = this.localOffset + offset;
    let buffer = this.list.first;

    while (buffer) {
      if (buffer.length > offset) {
        return buffer.data[offset];
      }

      offset -= buffer.length;
      buffer = buffer.next;
    }

    return 0;
  }

  read(bytes, littleEndian = false) {
    if (littleEndian === this.nativeEndian) {
      for (let i = 0; i < bytes; i++) {
        this.uint8[i] = this.readUInt8();
      }
    } else {
      for (let i = bytes - 1; i >= 0; i--) {
        this.uint8[i] = this.readUInt8();
      }
    }
  }

  peek(bytes, offset, littleEndian) {
    if (littleEndian == null) { littleEndian = false; }
    if (littleEndian === this.nativeEndian) {
      for (let i = 0; i < bytes; i++) {
        this.uint8[i] = this.peekUInt8(offset + i);
      }
    } else {
      for (let i = 0; i < bytes; i++) {
        this.uint8[bytes - i - 1] = this.peekUInt8(offset + i);
      }
    }
  }

  readInt8() {
    this.read(1);
    return this.int8[0];
  }

  peekInt8(offset = 0) {
    this.peek(1, offset);
    return this.int8[0];
  }

  readUInt16(littleEndian) {
    this.read(2, littleEndian);
    return this.uint16[0];
  }

  peekUInt16(offset = 0, littleEndian) {
    this.peek(2, offset, littleEndian);
    return this.uint16[0];
  }

  readInt16(littleEndian) {
    this.read(2, littleEndian);
    return this.int16[0];
  }

  peekInt16(offset = 0, littleEndian) {
    this.peek(2, offset, littleEndian);
    return this.int16[0];
  }

  readUInt24(littleEndian) {
    if (littleEndian) {
      return this.readUInt16(true) + (this.readUInt8() << 16);
    }
    return (this.readUInt16() << 8) + this.readUInt8();
  }

  peekUInt24(offset = 0, littleEndian) {
    if (littleEndian) {
      return this.peekUInt16(offset, true) + (this.peekUInt8(offset + 2) << 16);
    }
    return (this.peekUInt16(offset) << 8) + this.peekUInt8(offset + 2);
  }

  readInt24(littleEndian) {
    if (littleEndian) {
      return this.readUInt16(true) + (this.readInt8() << 16);
    }
    return (this.readInt16() << 8) + this.readUInt8();
  }

  peekInt24(offset = 0, littleEndian) {
    if (littleEndian) {
      return this.peekUInt16(offset, true) + (this.peekInt8(offset + 2) << 16);
    }
    return (this.peekInt16(offset) << 8) + this.peekUInt8(offset + 2);
  }

  readUInt32(littleEndian) {
    this.read(4, littleEndian);
    return this.uint32[0];
  }

  peekUInt32(offset = 0, littleEndian) {
    this.peek(4, offset, littleEndian);
    return this.uint32[0];
  }

  readInt32(littleEndian) {
    this.read(4, littleEndian);
    return this.int32[0];
  }

  peekInt32(offset = 0, littleEndian) {
    this.peek(4, offset, littleEndian);
    return this.int32[0];
  }

  readFloat32(littleEndian) {
    this.read(4, littleEndian);
    return this.float32[0];
  }

  peekFloat32(offset = 0, littleEndian) {
    this.peek(4, offset, littleEndian);
    return this.float32[0];
  }

  readFloat64(littleEndian) {
    this.read(8, littleEndian);
    return this.float64[0];
  }

  peekFloat64(offset = 0, littleEndian) {
    this.peek(8, offset, littleEndian);
    return this.float64[0];
  }

    // IEEE 80 bit extended float
  readFloat80(littleEndian) {
    this.read(10, littleEndian);
    return this.float80();
  }

  peekFloat80(offset = 0, littleEndian) {
    this.peek(10, offset, littleEndian);
    return this.float80();
  }

  readBuffer(length) {
    const result = AVBuffer.allocate(length);
    const to = result.data;

    for (let i = 0; i < length; i++) {
      to[i] = this.readUInt8();
    }

    return result;
  }

  peekBuffer(offset = 0, length) {
    const result = AVBuffer.allocate(length);
    const to = result.data;

    for (let i = 0; i < length; i++) {
      to[i] = this.peekUInt8(offset + i);
    }

    return result;
  }

  readSingleBuffer(length) {
    const result = this.list.first.slice(this.localOffset, length);
    this.advance(result.length);
    return result;
  }

  peekSingleBuffer(offset, length) {
    const result = this.list.first.slice(this.localOffset + offset, length);
    return result;
  }

  readString(length, encoding = 'ascii') {
    return this.decodeString(0, length, encoding, true);
  }

  peekString(offset = 0, length, encoding = 'ascii') {
    return this.decodeString(offset, length, encoding, false);
  }

  float80() {
    const [high, low] = Array.from(this.uint32);
    const a0 = this.uint8[9];
    const a1 = this.uint8[8];

    const sign = 1 - ((a0 >>> 7) * 2); // -1 or +1
    let exp = ((a0 & 0x7F) << 8) | a1;

    if ((exp === 0) && (low === 0) && (high === 0)) {
      return 0;
    }

    if (exp === 0x7fff) {
      if ((low === 0) && (high === 0)) {
        return sign * Infinity;
      }

      return NaN;
    }

    exp -= 16383;
    let out = low * Math.pow(2, exp - 31);
    out += high * Math.pow(2, exp - 63);

    return sign * out;
  }

  decodeString(offset, length, encoding, advance) {
    encoding = encoding.toLowerCase();
    const nullEnd = length === null ? 0 : -1;

    if (length == null) {
      length = Infinity;
    }

    const end = offset + length;
    let result = '';

    switch (encoding) {
      case 'ascii':
      case 'latin1': {
        let char;
        while ((offset < end) && ((char = this.peekUInt8(offset++)) !== nullEnd)) {
          result += String.fromCharCode(char);
        }
        break;
      }
      case 'utf8':
      case 'utf-8': {
        let b1;
        while ((offset < end) && ((b1 = this.peekUInt8(offset++)) !== nullEnd)) {
          let b2;
          let b3;
          if ((b1 & 0x80) === 0) {
            result += String.fromCharCode(b1);
          } else if ((b1 & 0xe0) === 0xc0) {
            // one continuation (128 to 2047)
            b2 = this.peekUInt8(offset++) & 0x3f;
            result += String.fromCharCode(((b1 & 0x1f) << 6) | b2);
          } else if ((b1 & 0xf0) === 0xe0) {
            // two continuation (2048 to 55295 and 57344 to 65535)
            b2 = this.peekUInt8(offset++) & 0x3f;
            b3 = this.peekUInt8(offset++) & 0x3f;
            result += String.fromCharCode(((b1 & 0x0f) << 12) | (b2 << 6) | b3);
          } else if ((b1 & 0xf8) === 0xf0) {
            // three continuation (65536 to 1114111)
            b2 = this.peekUInt8(offset++) & 0x3f;
            b3 = this.peekUInt8(offset++) & 0x3f;
            const b4 = this.peekUInt8(offset++) & 0x3f;

            // split into a surrogate pair
            const pt = (((b1 & 0x0f) << 18) | (b2 << 12) | (b3 << 6) | b4) - 0x10000;
            result += String.fromCharCode(0xd800 + (pt >> 10), 0xdc00 + (pt & 0x3ff));
          }
        }
        break;
      }
      case 'utf16-be':
      case 'utf16be':
      case 'utf16le':
      case 'utf16-le':
      case 'utf16bom':
      case 'utf16-bom': {
        let bom;
        let littleEndian;

        // find endianness
        switch (encoding) {
          case 'utf16be':
          case 'utf16-be': {
            littleEndian = false;
            break;
          }
          case 'utf16le':
          case 'utf16-le': {
            littleEndian = true;
            break;
          }
          case 'utf16bom':
          case 'utf16-bom':
          default: {
            if ((length < 2) || ((bom = this.peekUInt16(offset)) === nullEnd)) {
              if (advance) { this.advance(offset += 2); }
              return result;
            }

            littleEndian = (bom === 0xfffe);
            offset += 2;
            break;
          }
        }

        let w1;
        while ((offset < end) && ((w1 = this.peekUInt16(offset, littleEndian)) !== nullEnd)) {
          offset += 2;

          if ((w1 < 0xd800) || (w1 > 0xdfff)) {
            result += String.fromCharCode(w1);
          } else {
            const w2 = this.peekUInt16(offset, littleEndian);
            if ((w2 < 0xdc00) || (w2 > 0xdfff)) {
              throw new Error('Invalid utf16 sequence.');
            }

            result += String.fromCharCode(w1, w2);
            offset += 2;
          }
        }

        if (w1 === nullEnd) {
          offset += 2;
        }
        break;
      }
      default: {
        throw new Error(`Unknown encoding: ${encoding}`);
      }
    }

    if (advance) {
      this.advance(offset);
    }
    return result;
  }
}

class AVBitstream {
  constructor(stream$$1) {
    this.stream = stream$$1;
    this.bitPosition = 0;
  }

  copy() {
    const result = new AVBitstream(this.stream.copy());
    result.bitPosition = this.bitPosition;
    return result;
  }

  offset() { // Should be a property
    return (8 * this.stream.offset) + this.bitPosition;
  }

  available(bits) {
    return this.stream.available(((bits + 8) - this.bitPosition) / 8);
  }

  advance(bits) {
    const pos = this.bitPosition + bits;
    this.stream.advance(pos >> 3);
    this.bitPosition = pos & 7;
  }

  rewind(bits) {
    const pos = this.bitPosition - bits;
    this.stream.rewind(Math.abs(pos >> 3));
    this.bitPosition = pos & 7;
  }

  seek(offset) {
    const curOffset = this.offset();

    if (offset > curOffset) {
      this.advance(offset - curOffset);
    } else if (offset < curOffset) {
      this.rewind(curOffset - offset);
    }
  }

  align() {
    if (this.bitPosition !== 0) {
      this.bitPosition = 0;
      this.stream.advance(1);
    }
  }

  read(bits, signed, advance = true) {
    if (bits === 0) {
      return 0;
    }

    let a;
    const mBits = bits + this.bitPosition;
    if (mBits <= 8) {
      a = ((this.stream.peekUInt8() << this.bitPosition) & 0xff) >>> (8 - bits);
    } else if (mBits <= 16) {
      a = ((this.stream.peekUInt16() << this.bitPosition) & 0xffff) >>> (16 - bits);
    } else if (mBits <= 24) {
      a = ((this.stream.peekUInt24() << this.bitPosition) & 0xffffff) >>> (24 - bits);
    } else if (mBits <= 32) {
      a = (this.stream.peekUInt32() << this.bitPosition) >>> (32 - bits);
    } else if (mBits <= 40) {
      const a0 = this.stream.peekUInt8(0) * 0x0100000000; // same as a << 32
      const a1 = this.stream.peekUInt8(1) << 24 >>> 0;
      const a2 = this.stream.peekUInt8(2) << 16;
      const a3 = this.stream.peekUInt8(3) << 8;
      const a4 = this.stream.peekUInt8(4);

      a = a0 + a1 + a2 + a3 + a4;
      a %= Math.pow(2, 40 - this.bitPosition);                        // (a << bitPosition) & 0xffffffffff
      a = Math.floor(a / Math.pow(2, 40 - this.bitPosition - bits));  // a >>> (40 - bits)
    } else {
      throw new Error('Too many bits!');
    }

    if (signed) {
      // if the sign bit is turned on, flip the bits and add one to convert to a negative value
      if (mBits < 32) {
        if (a >>> (bits - 1)) {
          a = ((1 << bits >>> 0) - a) * -1;
        }
      } else if (a / Math.pow(2, bits - 1) | 0) {
        a = (Math.pow(2, bits) - a) * -1;
      }
    }

    if (advance) {
      this.advance(bits);
    }
    return a;
  }

  peek(bits, signed) {
    return this.read(bits, signed, false);
  }

  readLSB(bits, signed, advance = true) {
    if (bits === 0) {
      return 0;
    }
    if (bits > 40) {
      throw new Error('Too many bits!');
    }

    const mBits = bits + this.bitPosition;
    let a = (this.stream.peekUInt8(0)) >>> this.bitPosition;
    if (mBits > 8) {
      a |= (this.stream.peekUInt8(1)) << (8 - this.bitPosition);
    }
    if (mBits > 16) {
      a |= (this.stream.peekUInt8(2)) << (16 - this.bitPosition);
    }
    if (mBits > 24) {
      a += (this.stream.peekUInt8(3)) << (24 - this.bitPosition) >>> 0;
    }
    if (mBits > 32) {
      a += (this.stream.peekUInt8(4)) * Math.pow(2, 32 - this.bitPosition);
    }

    if (mBits >= 32) {
      a %= Math.pow(2, bits);
    } else {
      a &= (1 << bits) - 1;
    }

    if (signed) {
      // if the sign bit is turned on, flip the bits and add one to convert to a negative value
      if (mBits < 32) {
        if (a >>> (bits - 1)) {
          a = ((1 << bits >>> 0) - a) * -1;
        }
      } else if (a / Math.pow(2, bits - 1) | 0) {
        a = (Math.pow(2, bits) - a) * -1;
      }
    }

    if (advance) {
      this.advance(bits);
    }
    return a;
  }

  peekLSB(bits, signed) {
    return this.readLSB(bits, signed, false);
  }
}

class AVEventEmitter {
  on(event, fn) {
    if (this.events == null) { this.events = {}; }
    if (this.events[event] == null) { this.events[event] = []; }
    this.events[event].push(fn);
  }

  off(event, fn) {
    if (!this.events || !this.events[event]) {
      return;
    }

    const index = this.events[event].indexOf(fn);
    if (~index) {
      this.events[event].splice(index, 1);
    }
  }

  once(event, fn) {
    const cb = function cb(...args) {
      this.off(event, cb);
      fn.apply(this, args);
    };
    this.on(event, cb);
  }

  emit(event, ...args) {
    if (!this.events || !this.events[event]) {
      return;
    }

    // shallow clone with .slice() so that removing a handler while event is firing (as in once) doesn't cause errors
    for (const fn of this.events[event].slice()) {
      fn.apply(this, args);
    }
  }
}

class AVDemuxer extends AVEventEmitter {
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
    const stream$$1 = AVStream.fromBuffer(buffer);
    for (const format of Array.from(AVDemuxer.formats)) {
      if (format.probe(stream$$1)) {
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

class AVDecoder extends AVEventEmitter {
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

//
// The AudioDevice class is responsible for interfacing with various audio
// APIs in browsers, and for keeping track of the current playback time
// based on the device hardware time and the play/pause/seek state
//

class AVAudioDevice extends AVEventEmitter {
  constructor(sampleRate, channels) {
    super(sampleRate, channels);

    this.updateTime = this.updateTime.bind(this);
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.playing = false;
    this.currentTime = 0;
    this._lastTime = 0;
  }

  start() {
    if (this.playing) { return; }
    this.playing = true;

    if (this.device == null) {
      this.device = AVAudioDevice.create(this.sampleRate, this.channels);
    }
    if (!this.device) {
      throw new Error('No supported audio device found.');
    }

    this._lastTime = this.device.getDeviceTime();

    this._timer = setInterval(this.updateTime, 200);
    this.device.on('refill', this.refill = buffer => this.emit('refill', buffer)
    );
  }

  stop() {
    if (!this.playing) { return; }
    this.playing = false;

    this.device.off('refill', this.refill);
    clearInterval(this._timer);
  }

  destroy() {
    this.stop();
    if (this.device) {
      this.device.destroy();
    }
  }

  seek(currentTime) {
    this.currentTime = currentTime;
    if (this.playing) {
      this._lastTime = this.device.getDeviceTime();
    }
    this.emit('timeUpdate', this.currentTime);
  }

  updateTime() {
    const time = this.device.getDeviceTime();
    this.currentTime += (((time - this._lastTime) / this.device.sampleRate) * 1000) | 0;
    this._lastTime = time;
    this.emit('timeUpdate', this.currentTime);
  }

  static register(device) {
    AVAudioDevice.devices.push(device);
  }

  static create(sampleRate, channels) {
    for (const Device of Array.from(AVAudioDevice.devices)) {
      if (Device.supported) {
        return new Device(sampleRate, channels);
      }
    }

    return null;
  }
}

AVAudioDevice.devices = [];

// The Asset class is responsible for managing all aspects of the
// decoding pipeline from source to decoder.  You can use the Asset
// class to inspect information about an audio file, such as its
// format, metadata, and duration, as well as actually decode the
// file to linear PCM raw audio data.

/* global AVHTTPSource, AVFileSource */

//
// The Player class plays back audio data from various sources
// as decoded by the Asset class.  In addition, it handles
// common audio filters like panning and volume adjustment,
// and interfacing with AudioDevices to keep track of the
// playback time.
//

// common file type identifiers
// see http://mp4ra.org/filetype.html for a complete list
const MP4_TYPES = ['M4A ', 'M4P ', 'M4B ', 'M4V ', 'isom', 'mp42', 'qt  '];

class M4ADemuxer extends AVDemuxer {
  constructor(source, chunk) {
    super(source, chunk);

    // current atom heirarchy stacks
    this.atoms = [];
    this.offsets = [];

    // m4a files can have multiple tracks
    this.track = null;
    this.tracks = [];

    // corrections to bits per channel, base on formatID
    // (ffmpeg appears to always encode the bitsPerChannel as 16)
    this.BITS_PER_CHANNEL = {
      ulaw: 8,
      alaw: 8,
      in24: 24,
      in32: 32,
      fl32: 32,
      fl64: 64,
    };

    // lookup table for atom handlers
    this.lookup_table_atoms = {};

    // lookup table of container atom names
    this.lookup_table_containers = {};

    this.buildAtoms();
  }

  buildAtoms() {
    // declare a function to be used for parsing a given atom name
    const atom = (name, fn) => {
      const c = [];
      for (const container of Array.from(name.split('.').slice(0, -1))) {
        c.push(container);
        this.lookup_table_containers[c.join('.')] = true;
      }

      if (this.lookup_table_atoms[name] == null) {
        this.lookup_table_atoms[name] = {};
      }
      this.lookup_table_atoms[name].fn = fn;
    };

    // declare a function to be called after parsing of an atom and all sub-atoms has completed
    const after = (name, fn) => {
      if (this.lookup_table_atoms[name] == null) {
        this.lookup_table_atoms[name] = {};
      }
      this.lookup_table_atoms[name].after = fn;
    };

    atom('ftyp', () => {
      if (!MP4_TYPES.includes(this.stream.readString(4))) {
        this.emit('error', 'Not a valid M4A file.');
        return;
      }
      this.stream.advance(this.len - 4);
    });

    atom('moov.trak', () => {
      this.track = {};
      this.tracks.push(this.track);
    });

    atom('moov.trak.tkhd', () => {
      this.stream.advance(4); // version and flags

      this.stream.advance(8); // creation and modification time
      this.track.id = this.stream.readUInt32();

      this.stream.advance(this.len - 16);
    });

    atom('moov.trak.mdia.hdlr', () => {
      this.stream.advance(4); // version and flags

      this.stream.advance(4); // component type
      this.track.type = this.stream.readString(4);

      this.stream.advance(12); // component manufacturer, flags, and mask
      this.stream.advance(this.len - 24); // component name
    });

    atom('moov.trak.mdia.mdhd', () => {
      this.stream.advance(4); // version and flags
      this.stream.advance(8); // creation and modification dates

      this.track.timeScale = this.stream.readUInt32();
      this.track.duration = this.stream.readUInt32();

      this.stream.advance(4); // language and quality
    });

    atom('moov.trak.mdia.minf.stbl.stsd', () => {
      this.stream.advance(4); // version and flags

      const numEntries = this.stream.readUInt32();

      // just ignore the rest of the atom if this isn't an audio track
      if (this.track.type !== 'soun') {
        this.stream.advance(this.len - 8);
        return;
      }

      if (numEntries !== 1) {
        this.emit('error', 'Only expecting one entry in sample description atom!');
        return;
      }

      this.stream.advance(4); // size

      this.track.format = {};
      this.track.format.formatID = this.stream.readString(4);

      this.stream.advance(6); // reserved
      this.stream.advance(2); // data reference index

      const version = this.stream.readUInt16();
      this.stream.advance(6); // skip revision level and vendor

      this.track.format.channelsPerFrame = this.stream.readUInt16();
      this.track.format.bitsPerChannel = this.stream.readUInt16();

      this.stream.advance(4); // skip compression id and packet size

      this.track.format.sampleRate = this.stream.readUInt16();
      this.stream.advance(2);

      if (version === 1) {
        this.track.format.framesPerPacket = this.stream.readUInt32();
        this.stream.advance(4); // bytes per packet
        this.track.format.bytesPerFrame = this.stream.readUInt32();
        this.stream.advance(4); // bytes per sample
      } else if (version !== 0) {
        this.emit('error', 'Unknown version in stsd atom');
      }

      if (this.BITS_PER_CHANNEL[this.track.format.formatID] != null) {
        this.track.format.bitsPerChannel = this.BITS_PER_CHANNEL[this.track.format.formatID];
      }

      this.track.format.floatingPoint = ['fl32', 'fl64'].includes(this.track.format.formatID);
      this.track.format.littleEndian = (this.track.format.formatID === 'sowt') && (this.track.format.bitsPerChannel > 8);

      if (['twos', 'sowt', 'in24', 'in32', 'fl32', 'fl64', 'raw ', 'NONE'].includes(this.track.format.formatID)) {
        this.track.format.formatID = 'lpcm';
      }
    });

    atom('moov.trak.mdia.minf.stbl.stsd.alac', () => {
      this.stream.advance(4);
      this.track.cookie = this.stream.readBuffer(this.len - 4);
    });

    atom('moov.trak.mdia.minf.stbl.stsd.esds', () => {
      const offset = this.stream.offset + this.len;
      this.track.cookie = M4ADemuxer.readEsds(this.stream);
      this.stream.seek(offset); // skip garbage at the end
    });

    atom('moov.trak.mdia.minf.stbl.stsd.wave.enda', () => {
      this.track.format.littleEndian = !!this.stream.readUInt16();
    });

    // time to sample
    atom('moov.trak.mdia.minf.stbl.stts', () => {
      this.stream.advance(4); // version and flags

      const entries = this.stream.readUInt32();
      this.track.stts = [];
      for (let i = 0; i < entries; i++) {
        this.track.stts[i] = {
          count: this.stream.readUInt32(),
          duration: this.stream.readUInt32(),
        };
      }

      this.setupSeekPoints();
    });

    // sample to chunk
    atom('moov.trak.mdia.minf.stbl.stsc', () => {
      this.stream.advance(4); // version and flags

      const entries = this.stream.readUInt32();
      this.track.stsc = [];
      for (let i = 0; i < entries; i++) {
        this.track.stsc[i] = {
          first: this.stream.readUInt32(),
          count: this.stream.readUInt32(),
          id: this.stream.readUInt32(),
        };
      }

      this.setupSeekPoints();
    });

    // sample size
    atom('moov.trak.mdia.minf.stbl.stsz', () => {
      this.stream.advance(4); // version and flags

      this.track.sampleSize = this.stream.readUInt32();
      const entries = this.stream.readUInt32();

      if ((this.track.sampleSize === 0) && (entries > 0)) {
        this.track.sampleSizes = [];
        for (let i = 0; i < entries; i++) {
          this.track.sampleSizes[i] = this.stream.readUInt32();
        }
      }

      this.setupSeekPoints();
    });

    // chunk offsets
    atom('moov.trak.mdia.minf.stbl.stco', () => {
      // TODO: co64
      this.stream.advance(4); // version and flags

      const entries = this.stream.readUInt32();
      this.track.chunkOffsets = [];
      for (let i = 0; i < entries; i++) {
        this.track.chunkOffsets[i] = this.stream.readUInt32();
      }

      this.setupSeekPoints();
    });

    // chapter track reference
    atom('moov.trak.tref.chap', () => {
      const entries = this.len >> 2;
      this.track.chapterTracks = [];
      for (let i = 0, end = entries; i < end; i++) {
        this.track.chapterTracks[i] = this.stream.readUInt32();
      }
    });

    after('moov', () => {
      // if the mdat block was at the beginning rather than the end, jump back to it
      if (this.mdatOffset != null) {
        this.stream.seek(this.mdatOffset - 8);
      }

      // choose a track
      for (const track of Array.from(this.tracks)) {
        if (track.type === 'soun') {
          this.track = track;
          break;
        }
      }

      if (this.track.type !== 'soun') {
        this.track = null;
        this.emit('error', 'No audio tracks in m4a file.');
        return;
      }

      // emit info
      this.emit('format', this.track.format);
      this.emit('duration', ((this.track.duration / this.track.timeScale) * 1000) | 0);
      if (this.track.cookie) {
        this.emit('cookie', this.track.cookie);
      }

      // use the seek points from the selected track
      this.seekPoints = this.track.seekPoints;
    });

    atom('mdat', () => {
      if (!this.startedData) {
        if (this.mdatOffset == null) {
          this.mdatOffset = this.stream.offset;
        }
        // if we haven't read the headers yet, the mdat atom was at the beginning
        // rather than the end. Skip over it for now to read the headers first, and
        // come back later.
        if (this.tracks.length === 0) {
          const bytes = Math.min(this.stream.remainingBytes(), this.len);
          this.stream.advance(bytes);
          this.len -= bytes;
          return;
        }

        this.chunkIndex = 0;
        this.stscIndex = 0;
        this.sampleIndex = 0;
        this.tailOffset = 0;
        this.tailSamples = 0;

        this.startedData = true;
      }

      // read the chapter information if any
      if (!this.readChapters) {
        this.readChapters = this.parseChapters();
        // NOTE: Not sure why there is an assignment here, and don't know the proper fix.
        if (this.break = !this.readChapters) {
          return;
        }
        this.stream.seek(this.mdatOffset);
      }

      // get the starting offset
      const offset = this.track.chunkOffsets[this.chunkIndex] + this.tailOffset;
      let length = 0;

      // make sure we have enough data to get to the offset
      if (!this.stream.available(offset - this.stream.offset)) {
        this.break = true;
        return;
      }

      // seek to the offset
      this.stream.seek(offset);

      // calculate the maximum length we can read at once
      while (this.chunkIndex < this.track.chunkOffsets.length) {
        // calculate the size in bytes of the chunk using the sample size table
        const numSamples = this.track.stsc[this.stscIndex].count - this.tailSamples;
        let chunkSize = 0;
        let sample;
        for (sample = 0; sample < numSamples; sample++) {
          const size = this.track.sampleSize || this.track.sampleSizes[this.sampleIndex];

          // if we don't have enough data to add this sample, jump out
          if (!this.stream.available(length + size)) { break; }

          length += size;
          chunkSize += size;
          this.sampleIndex++;
        }

        // if we didn't make it through the whole chunk, add what we did use to the tail
        if (sample < numSamples) {
          this.tailOffset += chunkSize;
          this.tailSamples += sample;
          break;
        } else {
          // otherwise, we can move to the next chunk
          this.chunkIndex++;
          this.tailOffset = 0;
          this.tailSamples = 0;

          // if we've made it to the end of a list of subsequent chunks with the same number of samples,
          // go to the next sample to chunk entry
          if (((this.stscIndex + 1) < this.track.stsc.length) && ((this.chunkIndex + 1) === this.track.stsc[this.stscIndex + 1].first)) {
            this.stscIndex++;
          }

          // if the next chunk isn't right after this one, jump out
          if ((offset + length) !== this.track.chunkOffsets[this.chunkIndex]) {
            break;
          }
        }
      }

      // emit some data if we have any, otherwise wait for more
      if (length > 0) {
        this.emit('data', this.stream.readBuffer(length));
        this.break = this.chunkIndex === this.track.chunkOffsets.length;
      }
      this.break = true;
    });

    // metadata chunk
    atom('moov.udta.meta', () => {
      this.metadata = {};
      this.stream.advance(4); // version and flags
    });

    // emit when we're done
    after('moov.udta.meta', () => this.emit('metadata', this.metadata));

    // convienience function to generate metadata atom handler
    const meta = (field, name, fn) =>
      atom(`moov.udta.meta.ilst.${field}.data`, () => {
        this.stream.advance(8);
        this.len -= 8;
        return fn.call(this, name);
      });

    // string field reader
    const string = (field) => {
      this.metadata[field] = this.stream.readString(this.len, 'utf8');
    };

    // from http://atomicparsley.sourceforge.net/mpeg-4files.html
    meta('©alb', 'album', string);
    meta('©arg', 'arranger', string);
    meta('©art', 'artist', string);
    meta('©ART', 'artist', string);
    meta('aART', 'albumArtist', string);
    meta('catg', 'category', string);
    meta('©com', 'composer', string);
    meta('©cpy', 'copyright', string);
    meta('cprt', 'copyright', string);
    meta('©cmt', 'comments', string);
    meta('©day', 'releaseDate', string);
    meta('desc', 'description', string);
    meta('©gen', 'genre', string); // custom genres
    meta('©grp', 'grouping', string);
    meta('©isr', 'ISRC', string);
    meta('keyw', 'keywords', string);
    meta('©lab', 'recordLabel', string);
    meta('ldes', 'longDescription', string);
    meta('©lyr', 'lyrics', string);
    meta('©nam', 'title', string);
    meta('©phg', 'recordingCopyright', string);
    meta('©prd', 'producer', string);
    meta('©prf', 'performers', string);
    meta('purd', 'purchaseDate', string);
    meta('purl', 'podcastURL', string);
    meta('©swf', 'songwriter', string);
    meta('©too', 'encoder', string);
    meta('©wrt', 'composer', string);

    meta('covr', 'coverArt', (field) => {
      this.metadata[field] = this.stream.readBuffer(this.len);
    });

    /* istanbul ignore next */
    meta('gnre', 'genre', (field) => {
      // standard genres
      const genres = [
        'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge',
        'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B',
        'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska',
        'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient',
        'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical',
        'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
        'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop',
        'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial',
        'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy',
        'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle',
        'Native American', 'Cabaret', 'New Wave', 'Psychadelic', 'Rave', 'Showtunes',
        'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro',
        'Musical', 'Rock & Roll', 'Hard Rock', 'Folk', 'Folk/Rock', 'National Folk',
        'Swing', 'Fast Fusion', 'Bebob', 'Latin', 'Revival', 'Celtic', 'Bluegrass',
        'Avantgarde', 'Gothic Rock', 'Progressive Rock', 'Psychedelic Rock', 'Symphonic Rock',
        'Slow Rock', 'Big Band', 'Chorus', 'Easy Listening', 'Acoustic', 'Humour', 'Speech',
        'Chanson', 'Opera', 'Chamber Music', 'Sonata', 'Symphony', 'Booty Bass', 'Primus',
        'Porn Groove', 'Satire', 'Slow Jam', 'Club', 'Tango', 'Samba', 'Folklore', 'Ballad',
        'Power Ballad', 'Rhythmic Soul', 'Freestyle', 'Duet', 'Punk Rock', 'Drum Solo',
        'A Capella', 'Euro-House', 'Dance Hall',
      ];
      this.metadata[field] = genres[this.stream.readUInt16() - 1];
    });

    meta('tmpo', 'tempo', (field) => {
      this.metadata[field] = this.stream.readUInt16();
    });

    meta('rtng', 'rating', (field) => {
      const rating = this.stream.readUInt8();
      if (rating === 2) {
        this.metadata[field] = 'Clean';
      } else if (rating !== 0) {
        this.metadata[field] = 'Explicit';
      } else {
        this.metadata[field] = 'None';
      }
    });

    const diskTrack = (field) => {
      this.stream.advance(2);
      this.metadata[field] = `${this.stream.readUInt16()} of ${this.stream.readUInt16()}`;
      this.stream.advance(this.len - 6);
    };

    meta('disk', 'diskNumber', diskTrack);
    meta('trkn', 'trackNumber', diskTrack);

    const bool = (field) => {
      this.metadata[field] = this.stream.readUInt8() === 1;
    };

    meta('cpil', 'compilation', bool);
    meta('pcst', 'podcast', bool);
    meta('pgap', 'gapless', bool);
  }

  static probe(buffer) {
    return (buffer.peekString(4, 4) === 'ftyp') && MP4_TYPES.includes(buffer.peekString(8, 4));
  }

  readChunk() {
    this.break = false;

    while (this.stream.available(1) && !this.break) {
      // if we're ready to read a new atom, add it to the stack
      if (!this.readHeaders) {
        if (!this.stream.available(8)) {
          return;
        }

        this.len = this.stream.readUInt32() - 8;
        this.type = this.stream.readString(4);

        if (this.len === 0) { continue; }

        this.atoms.push(this.type);
        this.offsets.push(this.stream.offset + this.len);
        this.readHeaders = true;
      }

      // find a handler for the current atom heirarchy
      const path = this.atoms.join('.');
      let handler = this.lookup_table_atoms[path];

      if (handler && handler.fn) {
        // wait until we have enough data, unless this is the mdat atom
        if (!this.stream.available(this.len) && (path !== 'mdat')) {
          return;
        }

        // call the parser for the atom type
        handler.fn.call(this);

        // check if this atom can contain sub-atoms
        if (path in this.lookup_table_containers) {
          this.readHeaders = false;
        }
      } else if (path in this.lookup_table_containers) {
        // handle container atoms
        this.readHeaders = false;
        // unknown atom
      } else {
        // wait until we have enough data
        if (!this.stream.available(this.len)) {
          return;
        }
        this.stream.advance(this.len);
      }

      // pop completed items from the stack
      while (this.stream.offset >= this.offsets[this.offsets.length - 1]) {
        // call after handler
        handler = this.lookup_table_atoms[this.atoms.join('.')];
        if (handler && handler.after) {
          handler.after.call(this);
        }

        const type = this.atoms.pop();
        this.offsets.pop();
        this.readHeaders = false;
      }
    }
  }

    // reads a variable length integer
  static readDescrLen(stream$$1) {
    let len = 0;
    let count = 4;

    while (count--) {
      const c = stream$$1.readUInt8();
      len = (len << 7) | (c & 0x7f);
      if (!(c & 0x80)) { break; }
    }

    return len;
  }

  static readEsds(stream$$1) {
    stream$$1.advance(4); // version and flags

    let tag = stream$$1.readUInt8();
    let len = M4ADemuxer.readDescrLen(stream$$1);

    if (tag === 0x03) { // MP4ESDescrTag
      stream$$1.advance(2); // id
      const flags = stream$$1.readUInt8();

      if (flags & 0x80) { // streamDependenceFlag
        stream$$1.advance(2);
      }

      if (flags & 0x40) { // URL_Flag
        stream$$1.advance(stream$$1.readUInt8());
      }

      if (flags & 0x20) { // OCRstreamFlag
        stream$$1.advance(2);
      }
    } else {
      stream$$1.advance(2); // id
    }

    tag = stream$$1.readUInt8();
    len = M4ADemuxer.readDescrLen(stream$$1);

    if (tag === 0x04) { // MP4DecConfigDescrTag
      const codec_id = stream$$1.readUInt8(); // might want this... (isom.c:35)
      stream$$1.advance(1); // stream type
      stream$$1.advance(3); // buffer size
      stream$$1.advance(4); // max bitrate
      stream$$1.advance(4); // avg bitrate

      tag = stream$$1.readUInt8();
      len = M4ADemuxer.readDescrLen(stream$$1);

      if (tag === 0x05) { // MP4DecSpecificDescrTag
        return stream$$1.readBuffer(len);
      }
    }

    return null;
  }

    // once we have all the information we need, generate the seek table for this track
  setupSeekPoints() {
    if ((this.track.chunkOffsets == null) || (this.track.stsc == null) || (this.track.sampleSize == null) || (this.track.stts == null)) {
      return;
    }

    let stscIndex = 0;
    let sttsIndex = 0;
    let sttsSample = 0;
    let sampleIndex = 0;

    let offset = 0;
    let timestamp = 0;
    this.track.seekPoints = [];

    const result = [];
    for (let i = 0; i < this.track.chunkOffsets.length; i++) {
      let position = this.track.chunkOffsets[i];
      let item;
      for (let j = 0; j < this.track.stsc[stscIndex].count; j++) {
        // push the timestamp and both the physical position in the file
        // and the offset without gaps from the start of the data
        this.track.seekPoints.push({
          offset,
          position,
          timestamp,
        });

        const size = this.track.sampleSize || this.track.sampleSizes[sampleIndex++];
        offset += size;
        position += size;
        timestamp += this.track.stts[sttsIndex].duration;

        if (((sttsIndex + 1) < this.track.stts.length) && (++sttsSample === this.track.stts[sttsIndex].count)) {
          sttsSample = 0;
          sttsIndex++;
        }
      }

      if (((stscIndex + 1) < this.track.stsc.length) && ((i + 1) === this.track.stsc[stscIndex + 1].first)) {
        item = stscIndex++;
      }
      result.push(item);
    }
  }

  parseChapters() {
    this.track.chapterTracks = this.track.chapterTracks || [];
    if (this.track.chapterTracks.length <= 0) {
      return true;
    }

    // find the chapter track
    const id = this.track.chapterTracks[0];
    let track;
    for (track of this.tracks) {
      if (track.id === id) {
        break;
      }
    }

    if (track.id !== id) {
      this.emit('error', 'Chapter track does not exist.');
    }

    if (this.chapters == null) {
      this.chapters = [];
    }

    // use the seek table offsets to find chapter titles
    while (this.chapters.length < track.seekPoints.length) {
      const point = track.seekPoints[this.chapters.length];

      // make sure we have enough data
      if (!this.stream.available((point.position - this.stream.offset) + 32)) {
        return false;
      }

      // jump to the title offset
      this.stream.seek(point.position);

      // read the length of the title string
      const len = this.stream.readUInt16();
      let title = null;

      if (!this.stream.available(len)) {
        return false;
      }

      // if there is a BOM marker, read a utf16 string
      if (len > 2) {
        const bom = this.stream.peekUInt16();
        if ([0xfeff, 0xfffe].includes(bom)) {
          title = this.stream.readString(len, 'utf16-bom');
        }
      }

      // otherwise, use utf8
      if (title == null) {
        title = this.stream.readString(len, 'utf8');
      }

      // add the chapter title, timestamp, and duration
      let left;
      if (track.seekPoints[this.chapters.length + 1] && track.seekPoints[this.chapters.length + 1].timestamp) {
        left = track.seekPoints[this.chapters.length + 1].timestamp;
      }
      const nextTimestamp = left != null ? left : track.duration;
      this.chapters.push({
        title,
        timestamp: ((point.timestamp / track.timeScale) * 1000) | 0,
        duration: (((nextTimestamp - point.timestamp) / track.timeScale) * 1000) | 0,
      });
    }

    // we're done, so emit the chapter data
    this.emit('chapters', this.chapters);
    return true;
  }
}

AVDemuxer.register(M4ADemuxer);

class CAFDemuxer extends AVDemuxer {
  // https://developer.apple.com/library/content/qa/qa1534/_index.html
  // https://developer.apple.com/library/content/documentation/MusicAudio/Reference/CAFSpec/CAF_spec/CAF_spec.html
  // kAudioFormatLinearPCM      = 'lpcm',
  // kAudioFormatAppleIMA4      = 'ima4',
  // kAudioFormatMPEG4AAC       = 'aac ',
  // kAudioFormatMACE3          = 'MAC3',
  // kAudioFormatMACE6          = 'MAC6',
  // kAudioFormatULaw           = 'ulaw',
  // kAudioFormatALaw           = 'alaw',
  // kAudioFormatMPEGLayer1     = '.mp1',
  // kAudioFormatMPEGLayer2     = '.mp2',
  // kAudioFormatMPEGLayer3     = '.mp3',
  // kAudioFormatAppleLossless  = 'alac'

  static probe(buffer) {
    return buffer.peekString(0, 4) === 'caff';
  }

  readChunk() {
    if (!this.format && this.stream.available(64)) { // Number out of my behind
      if (this.stream.readString(4) !== 'caff') {
        this.emit('error', "Invalid CAF, does not begin with 'caff'");
        return;
      }

      // skip version and flags
      this.stream.advance(4);

      if (this.stream.readString(4) !== 'desc') {
        this.emit('error', "Invalid CAF, 'caff' is not followed by 'desc'");
        return;
      }

      if ((this.stream.readUInt32() !== 0) || (this.stream.readUInt32() !== 32)) {
        this.emit('error', "Invalid 'desc' size, should be 32");
        return;
      }

      this.format = {};
      this.format.sampleRate = this.stream.readFloat64();
      this.format.formatID = this.stream.readString(4);

      const flags = this.stream.readUInt32();
      if (this.format.formatID === 'lpcm') {
        this.format.floatingPoint = Boolean(flags & 1);
        this.format.littleEndian = Boolean(flags & 2);
      }

      this.format.bytesPerPacket = this.stream.readUInt32();
      this.format.framesPerPacket = this.stream.readUInt32();
      this.format.channelsPerFrame = this.stream.readUInt32();
      this.format.bitsPerChannel = this.stream.readUInt32();

      this.emit('format', this.format);
    }

    while (this.stream.available(1)) {
      let buffer;

      if (!this.headerCache) {
        this.headerCache = {
          type: this.stream.readString(4),
          oversize: this.stream.readUInt32() !== 0,
          size: this.stream.readUInt32(),
        };

        if (this.headerCache.oversize) {
          this.emit('error', 'Holy Shit, an oversized file, not supported in JS');
          return;
        }
      }

      switch (this.headerCache.type) {
        case 'kuki': {
          if (this.stream.available(this.headerCache.size)) {
            if (this.format.formatID === 'aac ') { // variations needed?
              const offset = this.stream.offset + this.headerCache.size;
              const cookie = M4ADemuxer.readEsds(this.stream);
              if (cookie) {
                this.emit('cookie', cookie);
              }
              this.stream.seek(offset); // skip extra garbage
            } else {
              buffer = this.stream.readBuffer(this.headerCache.size);
              this.emit('cookie', buffer);
            }

            this.headerCache = null;
          }
          break;
        }
        case 'pakt': {
          /* istanbul ignore else */
          if (this.stream.available(this.headerCache.size)) {
            if (this.stream.readUInt32() !== 0) {
              this.emit('error', 'Sizes greater than 32 bits are not supported.');
              return;
            }

            this.numPackets = this.stream.readUInt32();

            if (this.stream.readUInt32() !== 0) {
              this.emit('error', 'Sizes greater than 32 bits are not supported.');
              return;
            }

            this.numFrames = this.stream.readUInt32();
            this.primingFrames = this.stream.readUInt32();
            this.remainderFrames = this.stream.readUInt32();

            this.emit('duration', ((this.numFrames / this.format.sampleRate) * 1000) | 0);
            this.sentDuration = true;

            let byteOffset = 0;
            let sampleOffset = 0;
            for (let i = 0; i < this.numPackets; i++) {
              this.addSeekPoint(byteOffset, sampleOffset);
              byteOffset += this.format.bytesPerPacket || /* istanbul ignore next */ M4ADemuxer.readDescrLen(this.stream);
              sampleOffset += this.format.framesPerPacket || /* istanbul ignore next */ M4ADemuxer.readDescrLen(this.stream);
            }

            this.headerCache = null;
          }
          break;
        }
        // TODO: Haven't found a file with this type.
        /* istanbul ignore next */
        case 'info': {
          const entries = this.stream.readUInt32();
          const metadata = {};

          for (let i = 0, asc = entries >= 0; asc ? i < entries : i > entries; asc ? i++ : i--) {
            // null terminated strings
            const key = this.stream.readString(null);
            const value = this.stream.readString(null);
            metadata[key] = value;
          }

          this.emit('metadata', metadata);
          this.headerCache = null;
          break;
        }
        case 'data': {
          if (!this.sentFirstDataChunk) {
            // skip edit count
            this.stream.advance(4);
            this.headerCache.size -= 4;

            // calculate the duration based on bytes per packet if no packet table
            if ((this.format.bytesPerPacket !== 0) && !this.sentDuration) {
              this.numFrames = this.headerCache.size / this.format.bytesPerPacket;
              this.emit('duration', ((this.numFrames / this.format.sampleRate) * 1000) | 0);
            }

            this.sentFirstDataChunk = true;
          }

          buffer = this.stream.readSingleBuffer(this.headerCache.size);
          this.headerCache.size -= buffer.length;
          this.emit('data', buffer);

          if (this.headerCache.size <= 0) {
            this.headerCache = null;
          }
          break;
        }
        default: {
          /* istanbul ignore else */
          if (this.stream.available(this.headerCache.size)) {
            this.stream.advance(this.headerCache.size);
            this.headerCache = null;
          }
        }
      }
    }
  }
}

AVDemuxer.register(CAFDemuxer);

class AIFFDemuxer extends AVDemuxer {
  static probe(buffer) {
    return (buffer.peekString(0, 4) === 'FORM') && ['AIFF', 'AIFC'].includes(buffer.peekString(8, 4));
  }

  readChunk() {
    if (!this.readStart && this.stream.available(12)) {
      if (this.stream.readString(4) !== 'FORM') {
        this.emit('error', 'Invalid AIFF.');
        return;
      }

      this.fileSize = this.stream.readUInt32();
      this.fileType = this.stream.readString(4);
      this.readStart = true;

      if (!['AIFF', 'AIFC'].includes(this.fileType)) {
        this.emit('error', 'Invalid AIFF.');
        return;
      }
    }

    while (this.stream.available(1)) {
      let format;
      if (!this.readHeaders && this.stream.available(8)) {
        this.type = this.stream.readString(4);
        this.len = this.stream.readUInt32();
      }

      switch (this.type) {
        case 'COMM': {
          /* istanbul ignore next */
          if (!this.stream.available(this.len)) {
            return;
          }

          this.format = {
            formatID: 'lpcm',
            channelsPerFrame: this.stream.readUInt16(),
            sampleCount: this.stream.readUInt32(),
            bitsPerChannel: this.stream.readUInt16(),
            sampleRate: this.stream.readFloat80(),
            framesPerPacket: 1,
            littleEndian: false,
            floatingPoint: false,
          };

          this.format.bytesPerPacket = (this.format.bitsPerChannel / 8) * this.format.channelsPerFrame;

          if (this.fileType === 'AIFC') {
            format = this.stream.readString(4);

            this.format.littleEndian = (format === 'sowt') && (this.format.bitsPerChannel > 8);
            this.format.floatingPoint = ['fl32', 'fl64'].includes(format);

            if (['twos', 'sowt', 'fl32', 'fl64', 'NONE'].includes(format)) { format = 'lpcm'; }
            this.format.formatID = format;
            this.len -= 4;
          }

          this.stream.advance(this.len - 18);
          this.emit('format', this.format);
          this.emit('duration', ((this.format.sampleCount / this.format.sampleRate) * 1000) | 0);
          break;
        }
        case 'SSND': {
          if (!this.readSSNDHeader || !this.stream.available(4)) {
            const offset = this.stream.readUInt32();
            this.stream.advance(4); // skip block size
            this.stream.advance(offset); // skip to data
            this.readSSNDHeader = true;
          }

          const buffer = this.stream.readSingleBuffer(this.len);
          this.len -= buffer.length;
          this.readHeaders = this.len > 0;
          this.emit('data', buffer);
          break;
        }
        default: {
          if (!this.stream.available(this.len)) {
            return;
          }
          this.stream.advance(this.len);
        }
      }

      if (this.type !== 'SSND') {
        this.readHeaders = false;
      }
    }
  }
}

AVDemuxer.register(AIFFDemuxer);

class WAVEDemuxer extends AVDemuxer {
  constructor(source, chunk) {
    super(source, chunk);

    this.wave_formats = {
      // 0x0000:      // Unknown
      0x0001: 'lpcm', // Pulse Code Modulation (PCM) / Uncompressed
      // 0x0002:      // Microsoft ADPCM
      0x0003: 'lpcm', // Unknown
      0x0006: 'alaw', // ITU G.711 a-law
      0x0007: 'ulaw', // ITU G.711 µ-law
      // 0x0011:      // IMA ADPCM
      // 0x0016:      // ITU G.723 ADPCM (Yamaha)
      // 0x0031:      // GSM 6.10
      // 0x0040:      // ITU G.721 ADPCM
      // 0x0050:      // MPEG
    };
  }

  static probe(buffer) {
    return (buffer.peekString(0, 4) === 'RIFF') && (buffer.peekString(8, 4) === 'WAVE');
  }

  readChunk() {
    if (!this.readStart && this.stream.available(12)) {
      if (this.stream.readString(4) !== 'RIFF') {
        this.emit('error', 'Invalid WAV file (No RIFF).');
        return;
      }

      this.fileSize = this.stream.readUInt32(true);
      this.readStart = true;

      if (this.stream.readString(4) !== 'WAVE') {
        this.emit('error', 'Invalid WAV file (No WAVE).');
        return;
      }
    }

    while (this.stream.available(1)) {
      if (!this.readHeaders && this.stream.available(8)) {
        this.type = this.stream.readString(4);
        this.len = this.stream.readUInt32(true); // little endian
      }

      switch (this.type) {
        case 'fmt ': {
          const encoding = this.stream.readUInt16(true);
          if (this.wave_formats[encoding] == null) {
            this.emit('error', `Unsupported format in WAV file. (${encoding})`);
            return;
          }

          this.format = {
            formatID: this.wave_formats[encoding],
            floatingPoint: encoding === 0x0003,
            littleEndian: this.wave_formats[encoding] === 'lpcm',
            channelsPerFrame: this.stream.readUInt16(true),
            sampleRate: this.stream.readUInt32(true),
            framesPerPacket: 1,
          };

          this.stream.advance(4); // bytes/sec.
          this.stream.advance(2); // block align

          this.format.bitsPerChannel = this.stream.readUInt16(true);
          this.format.bytesPerPacket = (this.format.bitsPerChannel / 8) * this.format.channelsPerFrame;

          this.emit('format', this.format);

          // Advance to the next chunk
          this.stream.advance(this.len - 16);
          break;
        }
        case 'data': {
          if (!this.sentDuration) {
            const bytes = this.format.bitsPerChannel / 8;
            this.emit('duration', ((this.len / bytes / this.format.channelsPerFrame / this.format.sampleRate) * 1000) | 0);
            this.sentDuration = true;
          }

          const buffer = this.stream.readSingleBuffer(this.len);
          this.len -= buffer.length;
          this.readHeaders = this.len > 0;
          this.emit('data', buffer);
          break;
        }
        default: {
          if (!this.stream.available(this.len)) {
            return;
          }
          this.stream.advance(this.len);
        }
      }

      if (this.type !== 'data') {
        this.readHeaders = false;
      }
    }
  }
}

AVDemuxer.register(WAVEDemuxer);

class AUDemuxer extends AVDemuxer {
  constructor(source, chunk) {
    super(source, chunk);

    this.bps = [
      null, //  0: N/A
      8,    //  1: 8-bit G.711 µ-law
      8,    //  2: 8-bit linear PCM
      16,   //  3: 16-bit linear PCM
      24,   //  4: 24-bit linear PCM
      32,   //  5: 32-bit linear PCM
      32,   //  6: 32-bit IEEE floating point
      64,   //  7: 64-bit IEEE floating point
      null, //  8: Fragmented sample data
      null, //  9: DSP program
      null, // 10: 8-bit fixed point
      null, // 11: 16-bit fixed point
      null, // 12: 24-bit fixed point
      null, // 13: 32-bit fixed point
      null, // 14: N/A
      null, // 15: N/A
      null, // 16: N/A
      null, // 17: N/A
      null, // 18: 16-bit linear with emphasis
      null, // 19: 16-bit linear compressed
      null, // 20: 16-bit linear with emphasis and compression
      null, // 21: Music kit DSP commands
      null, // 22: N/A
      null, // 23: 4-bit compressed using the ITU-T G.721 ADPCM voice data encoding scheme
      null, // 24: ITU-T G.722 SB-ADPCM
      null, // 25: ITU-T G.723 3-bit ADPCM
      null, // 26: ITU-T G.723 5-bit ADPCM
      8,    // 27: 8-bit G.711 A-law
    ];

    this.au_formats = {
      1: 'ulaw',
      27: 'alaw',
    };
  }

  static probe(buffer) {
    return buffer.peekString(0, 4) === '.snd';
  }

  readChunk() {
    if (!this.readHeader && this.stream.available(24)) {
      if (this.stream.readString(4) !== '.snd') {
        this.emit('error', 'Invalid AU file.');
        return;
      }

      const dataOffset = this.stream.readUInt32();
      const dataSize = this.stream.readUInt32();
      const encoding = this.stream.readUInt32();

      this.format = {
        formatID: this.au_formats[encoding] || 'lpcm',
        littleEndian: false,
        floatingPoint: [6, 7].includes(encoding),
        bitsPerChannel: this.bps[encoding],
        sampleRate: this.stream.readUInt32(),
        channelsPerFrame: this.stream.readUInt32(),
        framesPerPacket: 1,
        dataOffset,
      };

      if (this.format.bitsPerChannel == null) {
        this.emit('error', 'Unsupported encoding in AU file.');
        return;
      }

      this.format.bytesPerPacket = (this.format.bitsPerChannel / 8) * this.format.channelsPerFrame;

      if (dataSize !== 0xffffffff) {
        const bytes = this.format.bitsPerChannel / 8;
        this.emit('duration', ((dataSize / bytes / this.format.channelsPerFrame / this.format.sampleRate) * 1000) | 0);
      }

      this.emit('format', this.format);
      this.readHeader = true;
    }

    if (this.readHeader) {
      while (this.stream.available(1)) {
        this.emit('data', this.stream.readSingleBuffer(this.stream.remainingBytes()));
      }
    }
  }
}

AVDemuxer.register(AUDemuxer);

class LPCMDecoder extends AVDecoder {
  constructor(demuxer, format) {
    super(demuxer, format);

    this.readChunk = this.readChunk.bind(this);
  }

  readChunk() {
    let output;
    const { stream: stream$$1 } = this;
    const { littleEndian } = this.format;
    const chunkSize = Math.min(4096, stream$$1.remainingBytes());
    const samples = (chunkSize / (this.format.bitsPerChannel / 8)) | 0;

    if (chunkSize < (this.format.bitsPerChannel / 8)) {
      return null;
    }

    if (this.format.floatingPoint) {
      switch (this.format.bitsPerChannel) {
        case 32: {
          output = new Float32Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream$$1.readFloat32(littleEndian);
          }
          break;
        }
        case 64: {
          output = new Float64Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream$$1.readFloat64(littleEndian);
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
            output[i] = stream$$1.readInt8();
          }
          break;
        }
        case 16: {
          output = new Int16Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream$$1.readInt16(littleEndian);
          }
          break;
        }
        case 24: {
          output = new Int32Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream$$1.readInt24(littleEndian);
          }
          break;
        }
        case 32: {
          output = new Int32Array(samples);
          for (let i = 0; i < samples; i++) {
            output[i] = stream$$1.readInt32(littleEndian);
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

class XLAWDecoder extends AVDecoder {
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
    const { stream: stream$$1, table } = this;

    const samples = Math.min(4096, stream$$1.remainingBytes());
    if (samples === 0) {
      return null;
    }

    const output = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      output[i] = table[stream$$1.readUInt8()];
    }

    return output;
  }
}

AVDecoder.register('ulaw', XLAWDecoder);
AVDecoder.register('alaw', XLAWDecoder);

class NodeSpeakerDevice extends AVEventEmitter {
  constructor(sampleRate, channels) {
    super();

    this.refill = this.refill.bind(this);
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.speaker = new Speaker({
      channels: this.channels,
      sampleRate: this.sampleRate,
      bitDepth: 32,
      float: true,
      signed: true,
    });

    this.buffer = null;
    this.currentFrame = 0;
    this.ended = false;

    // setup a node readable stream and pipe to speaker output
    this.input = new Readable();
    this.input._read = this.refill;
    this.input.pipe(this.speaker);
  }

  refill(n) {
    const length = n / 4;
    const array = new Float32Array(length);

    this.emit('refill', array);
    if (this.ended) {
      return;
    }

    if (this.buffer && this.buffer.length !== n) {
      this.buffer = new Buffer(n);
    }

    // copy the data from the Float32Array into the node buffer
    let offset = 0;
    for (const frame of Array.from(array)) {
      this.buffer.writeFloatLE(frame, offset);
      offset += 4;
    }

    this.input.push(this.buffer);
    this.currentFrame += length / this.channels;
  }

  destroy() {
    this.ended = true;
    this.input.push(null);
  }

  getDeviceTime() {
    return this.currentFrame;
  }
}

AVAudioDevice.register(NodeSpeakerDevice);
