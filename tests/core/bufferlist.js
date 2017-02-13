import test from 'ava';
import AVBuffer from './../../src/core/buffer';
import AVBufferList from './../../src/core/bufferlist';

test('append', (t) => {
  const list = new AVBufferList();
  const buffer = new AVBuffer(new Uint8Array([1, 2, 3]));
  list.append(buffer);

  t.is(1, list.numBuffers);
  t.is(1, list.availableBuffers);
  t.is(3, list.availableBytes);
  t.is(buffer, list.first);
  t.is(buffer, list.last);
  t.is(null, buffer.prev);
  t.is(null, buffer.next);

  const buffer2 = new AVBuffer(new Uint8Array([4, 5, 6]));
  list.append(buffer2);

  t.is(2, list.numBuffers);
  t.is(2, list.availableBuffers);
  t.is(6, list.availableBytes);
  t.is(buffer, list.first);
  t.is(buffer2, list.last);

  t.is(null, buffer.prev);
  t.is(buffer2, buffer.next);
  t.is(buffer, buffer2.prev);
  t.is(null, buffer2.next);
});

test('advance', (t) => {
  const list = new AVBufferList();
  const buffer1 = AVBuffer.allocate(3);
  const buffer2 = AVBuffer.allocate(3);
  list.append(buffer1);
  list.append(buffer2);

  t.is(2, list.numBuffers);
  t.is(2, list.availableBuffers);
  t.is(6, list.availableBytes);
  t.is(buffer1, list.first);

  t.is(true, list.advance());
  t.is(2, list.numBuffers);
  t.is(1, list.availableBuffers);
  t.is(3, list.availableBytes);
  t.is(buffer2, list.first);

  t.is(false, list.advance());
  t.is(null, list.first);
  t.is(2, list.numBuffers);
  t.is(0, list.availableBuffers);
  t.is(0, list.availableBytes);
});

test('rewind', (t) => {
  const list = new AVBufferList();
  const buffer1 = AVBuffer.allocate(3);
  const buffer2 = AVBuffer.allocate(3);
  list.append(buffer1);
  list.append(buffer2);

  t.is(2, list.numBuffers);
  t.is(2, list.availableBuffers);
  t.is(6, list.availableBytes);

  t.is(true, list.advance());
  t.is(buffer2, list.first);
  t.is(2, list.numBuffers);
  t.is(1, list.availableBuffers);
  t.is(3, list.availableBytes);

  t.is(true, list.rewind());
  t.is(buffer1, list.first);
  t.is(2, list.numBuffers);
  t.is(2, list.availableBuffers);
  t.is(6, list.availableBytes);

      // can't rewind anymore so nothing should change
  t.is(false, list.rewind());
  t.is(buffer1, list.first);
  t.is(2, list.numBuffers);
  t.is(2, list.availableBuffers);
  t.is(6, list.availableBytes);

      // advancing past the end of the list and then rewinding should give us the last buffer
  t.is(true, list.advance());
  t.is(false, list.advance());
  t.is(null, list.first);
  t.is(2, list.numBuffers);
  t.is(0, list.availableBuffers);
  t.is(0, list.availableBytes);

  t.is(true, list.rewind());
  t.is(buffer2, list.first);
  t.is(2, list.numBuffers);
  t.is(1, list.availableBuffers);
  t.is(3, list.availableBytes);
});

test('reset', (t) => {
  const list = new AVBufferList();
  const buffer1 = AVBuffer.allocate(3);
  const buffer2 = AVBuffer.allocate(3);
  const buffer3 = AVBuffer.allocate(3);
  list.append(buffer1);
  list.append(buffer2);
  list.append(buffer3);

  t.is(buffer1, list.first);
  t.is(3, list.numBuffers);
  t.is(3, list.availableBuffers);
  t.is(9, list.availableBytes);

  t.is(true, list.advance());
  t.is(buffer2, list.first);
  t.is(3, list.numBuffers);
  t.is(2, list.availableBuffers);
  t.is(6, list.availableBytes);

  t.is(true, list.advance());
  t.is(buffer3, list.first);
  t.is(3, list.numBuffers);
  t.is(1, list.availableBuffers);
  t.is(3, list.availableBytes);

  list.reset();
  t.is(buffer1, list.first);
  t.is(3, list.numBuffers);
  t.is(3, list.availableBuffers);
  t.is(9, list.availableBytes);
});

test('copy', (t) => {
  const list = new AVBufferList();
  const buffer = AVBuffer.allocate(3);
  list.append(buffer);

  const copy = list.copy();

  t.is(1, list.numBuffers, copy.numBuffers);
  t.is(list.availableBuffers, copy.availableBuffers);
  t.is(list.availableBytes, copy.availableBytes);
  t.is(list.first, copy.first);
});
