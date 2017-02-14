import test from 'ava';
import CRC32 from './../_crc32';
import AVHTTPSource from './../../src/sources/node/http';

// check that the data returned by the source is correct, using a CRC32 checksum
test.cb('data', (t) => {
  const crc = new CRC32();
  const source = new AVHTTPSource('http://localhost:8181/tests/data/m4a/base.m4a');

  source.on('data', (chunk) => {
    crc.update(chunk);
  });

  source.on('end', () => {
    t.is(crc.toHex(), '84d9f967');
    t.end();
  });

  source.start();
});

test.cb('start with resume', (t) => {
  const source = new AVHTTPSource('http://localhost:8181/tests/data/m4a/base.m4a');

  const resume = () => {
    t.true(true);
    t.end();
  };

  source.response = { resume };
  source.start();
});

test.cb('progress', (t) => {
  const source = new AVHTTPSource('http://localhost:8181/tests/data/m4a/base.m4a');

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

  source.start();
});

test.cb('invalid url error', (t) => {
  const source = new AVHTTPSource('http://dlfigu');

  source.on('error', () => {
    t.truthy(true);
    t.end();
  });

  source.start();
});

test.cb('404', (t) => {
  const source = new AVHTTPSource('http://localhost:8181/tests/data/nothing.m4a');

  source.on('error', () => {
    t.truthy(true);
    t.end();
  });

  source.start();
});
