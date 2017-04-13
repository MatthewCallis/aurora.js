import test from 'ava';
import path from 'path';
import CRC32 from './../_crc32';
import AVFileSource from './../../src/sources/node/file';

const getSource = (fn, file = 'm4a/base.m4a') => {
  // if we're in Node, we can read any file we like, otherwise simulate by reading a blob from an XHR and loading it using a FileSource
  if (process) {
    const filepath = path.resolve(__dirname, `../data/${file}`);
    fn(new AVFileSource(filepath));
    return;
  }

  const xhr = new XMLHttpRequest();
  xhr.open('GET', `http://localhost:8181/data/${file}`);
  xhr.responseType = 'blob';
  xhr.send();
  xhr.onload = () => {
    fn(new AVFileSource(xhr.response));
  };
};

test.cb('getSize fs error', (t) => {
  getSource((source) => {
    source.filename = 'fake-file';
    source.on('error', (error) => {
      t.is(error.name, 'Error');
      t.is(error.message, 'ENOENT: no such file or directory, stat \'fake-file\'');
      t.end();
    });
    source.getSize();
  });
});

test.cb('start fs error', (t) => {
  getSource((source) => {
    source.filename = 'fake-file';
    source.size = 1;
    source.on('error', (error) => {
      t.is(error.name, 'Error');
      t.is(error.message, 'ENOENT: no such file or directory, open \'fake-file\'');
      t.end();
    });
    source.start();
  });
});

test.cb('data', (t) => {
  getSource((source) => {
    const crc = new CRC32();
    source.on('data', chunk => crc.update(chunk));

    source.on('end', () => {
      t.is(crc.toHex(), '84d9f967');
      t.end();
    });

    source.start();
  });
});

test.cb('progress', (t) => {
  getSource((source) => {
    let lastProgress = 0;
    source.on('progress', (progress) => {
      t.true(progress > lastProgress, 'progress > lastProgress');
      t.true(progress <= 100, 'progress <= 100');
      lastProgress = progress;
    });

    source.on('end', () => {
      t.is(lastProgress, 100);
      t.end();
    });

    source.start();
  });
});

test.cb('pause', (t) => {
  getSource((source) => {
    source.on('data', () => {
      source.pause();
      t.true(source.paused);
      source.start();
    });

    source.on('end', () => {
      t.false(source.paused);
      t.end();
    });

    source.start();
  });
});
