import test from 'ava';
import AVBuffer from './../../src/core/buffer';

const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const buffer = new AVBuffer(bytes);

test('length', (t) => {
  t.is(10, buffer.length);
});

test('allocate', (t) => {
  const buf = AVBuffer.allocate(10);
  t.is(10, buf.length);
  t.truthy(buf.data instanceof Uint8Array);
  t.is(10, buf.data.length);
});

test('copy', (t) => {
  const copy = buffer.copy();

  t.is(buffer.length, copy.length);
  t.not(buffer.data, copy.data);
  t.is(buffer.data.length, copy.data.length);
});

test('slice', (t) => {
  t.is(4, buffer.slice(0, 4).length);
  t.is(bytes, buffer.slice(0, 100).data);
  t.deepEqual(new AVBuffer(bytes.subarray(3, 6)), buffer.slice(3, 3));
  t.is(5, buffer.slice(5).length);
});

test('create from ArrayBuffer', (t) => {
  const buf = new AVBuffer(new ArrayBuffer(9));
  t.is(9, buf.length);
  t.truthy(buf.data instanceof Uint8Array);
  t.is(9, buf.data.length);
  t.deepEqual(buf, new AVBuffer(new Uint8Array(9)));
});

test('create from typed array', (t) => {
  const buf = new AVBuffer(new Uint32Array(9));
  t.is(36, buf.length);
  t.truthy(buf.data instanceof Uint8Array);
  t.is(36, buf.data.length);
  t.deepEqual(buf, new AVBuffer(new Uint8Array(36)));
});

test('create from sliced typed array', (t) => {
  const buf = new AVBuffer(new Uint32Array(9).subarray(2, 6));
  t.is(16, buf.length);
  t.truthy(buf.data instanceof Uint8Array);
  t.is(16, buf.data.length);
  t.deepEqual(buf, new AVBuffer(new Uint8Array(new ArrayBuffer(36), 8, 16)));
});

test('create from array', (t) => {
  const buf = new AVBuffer([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  t.is(9, buf.length);
  t.truthy(buf.data instanceof Uint8Array);
  t.is(9, buf.data.length);
  t.deepEqual(buf, new AVBuffer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])));
});

test('create from number', (t) => {
  const buf = new AVBuffer(9);
  t.is(9, buf.length);
  t.truthy(buf.data instanceof Uint8Array);
  t.is(9, buf.data.length);
  t.deepEqual(buf, new AVBuffer(new Uint8Array(9)));
});

test('create from another AVBuffer', (t) => {
  const buf = new AVBuffer(new AVBuffer(9));
  t.is(9, buf.length);
  t.truthy(buf.data instanceof Uint8Array);
  t.is(9, buf.data.length);
  t.deepEqual(buf, new AVBuffer(new Uint8Array(9)));
});

// Node
if (process) {
  test('create from node buffer', (t) => {
    const buf = new AVBuffer(new Buffer([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    t.is(9, buf.length);
    t.truthy(buf.data instanceof Uint8Array);
    t.is(9, buf.data.length);
    t.deepEqual(buf, new AVBuffer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])));
  });
}

test('error constructing', (t) => {
  t.throws(() => new AVBuffer('some string'));

  t.throws(() => new AVBuffer(true));
});

if (typeof Blob !== 'undefined' && Blob !== null) {
  test('makeBlob', (t) => {
    t.truthy(AVBuffer.makeBlob(bytes) instanceof Blob);
  });

  test('makeBlobURL', (t) => {
    t.is('string', typeof AVBuffer.makeBlobURL(bytes));
  });

  test('toBlob', (t) => {
    t.truthy(buffer.toBlob() instanceof Blob);
  });

  test('toBlobURL', (t) => {
    t.is('string', typeof buffer.toBlobURL());
  });
}
