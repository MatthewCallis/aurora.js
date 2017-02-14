import fs from 'fs';
import path from 'path';
import test from 'ava';

import AVBuffer from './../../src/core/buffer';
import AVBufferList from './../../src/core/bufferlist';
import AVBufferSource from './../../src/sources/buffer';
import CRC32 from './../_crc32';

let buffer;

const getData = (fn) => {
  if (buffer) {
    fn();
    return;
  }

  // If we're in Node, we can read any file we like, otherwise simulate by reading a blob from an XHR and loading it using a FileSource.
  const file = 'm4a/base.m4a';

  if (process) {
    const filepath = path.resolve(__dirname, `../data/${file}`);
    fs.readFile(filepath, (err, data) => {
      if (err) {
        throw err;
      }
      buffer = new Uint8Array(data);
      fn();
    });
    return;
  }

  const xhr = new XMLHttpRequest();
  xhr.open('GET', `http://localhost:8181/data/${file}`);
  xhr.responseType = 'arraybuffer';
  xhr.send();
  xhr.onload = () => {
    buffer = new Uint8Array(xhr.response);
    fn();
  };
};

test.cb('single AVBuffer', (t) => {
  getData(() => {
    const crc = new CRC32();
    const source = new AVBufferSource(new AVBuffer(buffer));

    source.on('data', chunk => crc.update(chunk));

    source.on('progress', progress => t.is(progress, 100));

    source.on('end', () => {
      t.is(crc.toHex(), '84d9f967');
      t.end();
    });

    source.start();
  });
});

test.cb('single Uint8Array', (t) => {
  getData(() => {
    const crc = new CRC32();
    const source = new AVBufferSource(buffer);

    source.on('data', chunk => crc.update(chunk));

    source.on('progress', progress => t.is(progress, 100));

    source.on('end', () => {
      t.is(crc.toHex(), '84d9f967');
      t.end();
    });

    source.start();
  });
});

test.cb('single ArrayBuffer', (t) => {
  getData(() => {
    const crc = new CRC32();
    const source = new AVBufferSource(buffer.buffer);

    source.on('data', chunk => crc.update(chunk));

    source.on('progress', progress => t.is(progress, 100));

    source.on('end', () => {
      t.is(crc.toHex(), '84d9f967');
      t.end();
    });

    source.start();
  });
});

test.cb('AVBufferList', (t) => {
  getData(() => {
    const list = new AVBufferList();
    const buffers = [
      new AVBuffer(buffer),
      new AVBuffer(buffer),
      new AVBuffer(buffer),
    ];

    list.append(buffers[0]);
    list.append(buffers[1]);
    list.append(buffers[2]);

    const source = new AVBufferSource(list);

    let count = 0;
    source.on('data', chunk => t.is(chunk, buffers[count++]));

    let pcount = 0;
    source.on('progress', progress => t.is(progress, ((++pcount / 3) * 100) | 0));

    source.on('end', () => {
      t.is(count, 3);
      t.end();
    });

    source.start();
  });
});

test.cb('pause', (t) => {
  getData(() => {
    const source = new AVBufferSource(new AVBuffer(buffer));

    source.on('data', () => {
      source.pause();
    });

    source.on('end', () => {
      t.true(source.paused);
      t.end();
    });

    source.start();
  });
});

// Pauses, rewinds buffer list.
test.cb('reset', (t) => {
  getData(() => {
    const source = new AVBufferSource(new AVBuffer(buffer));

    source.on('data', () => {
      source.reset();
    });

    source.on('end', () => {
      t.true(source.paused);
      t.end();
    });

    source.start();
  });
});
