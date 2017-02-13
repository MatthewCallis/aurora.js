import test from 'ava';
import CRC32 from './../_crc32';
import AVFileSource from './../../src/sources/node/file';

const getSource = (fn) => {
  // if we're in Node, we can read any file we like, otherwise simulate by reading a blob from an XHR and loading it using a FileSource
  if (process) {
    fn(new AVFileSource('../data/m4a/base.m4a'));
    return;
  }

  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'http://localhost:8181/data/m4a/base.m4a');
  xhr.responseType = 'blob';
  xhr.send();
  xhr.onload = () => {
    fn(new AVFileSource(xhr.response));
  };
};

test.cb('data', (t) => {
  getSource((source) => {
    const crc = new CRC32();
    source.on('data', chunk => crc.update(chunk));

    source.on('end', () => {
      t.is(crc.toHex(), '84d9f967');
      t.end();
    });

    return source.start();
  });
});

test.cb('progress', (t) => {
  getSource((source) => {
    let lastProgress = 0;
    source.on('progress', (progress) => {
      t.truthy(progress > lastProgress, 'progress > lastProgress');
      t.truthy(progress <= 100, 'progress <= 100');
      lastProgress = progress;
    });

    source.on('end', () => {
      t.is(lastProgress, 100);
      t.end();
    });

    return source.start();
  });
});
