import AUDemuxer from './../../src/demuxers/au';
import demuxerTest from './_demuxerTest';

demuxerTest('bei16', {
  file: 'au/bei16.au',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 16,
    channelsPerFrame: 2,
    bytesPerPacket: 4,
    framesPerPacket: 1,
    littleEndian: false,
    floatingPoint: false,
    dataOffset: 28,
  },
  duration: 7430,
  data: 'd4c3bdc0',
});

demuxerTest('bef32', {
  file: 'au/bef32.au',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 32,
    channelsPerFrame: 2,
    bytesPerPacket: 8,
    framesPerPacket: 1,
    littleEndian: false,
    floatingPoint: true,
    dataOffset: 28,
  },
  duration: 7430,
  data: '52dbaba2',
});

demuxerTest('alaw', {
  file: 'au/alaw.au',
  format: {
    formatID: 'alaw',
    sampleRate: 44100,
    bitsPerChannel: 8,
    channelsPerFrame: 2,
    bytesPerPacket: 2,
    framesPerPacket: 1,
    littleEndian: false,
    floatingPoint: false,
    dataOffset: 24,
  },
  duration: 7430,
  data: 'e49cda0c',
});

demuxerTest('ulaw', {
  file: 'au/ulaw.au',
  format: {
    formatID: 'ulaw',
    sampleRate: 44100,
    bitsPerChannel: 8,
    channelsPerFrame: 2,
    bytesPerPacket: 2,
    framesPerPacket: 1,
    littleEndian: false,
    floatingPoint: false,
    dataOffset: 28,
  },
  duration: 7430,
  data: '18b71b9b',
});


demuxerTest('Invalid AU due to missing .snd header', {
  file: 'aiff/bei16.aiff',
  demuxer: AUDemuxer,
  error: 'Invalid AU file.',
});

demuxerTest('Invalid AU due to unsupported encoding.', {
  file: 'au/alaw_bad_header.au',
  demuxer: AUDemuxer,
  error: 'Unsupported encoding in AU file.',
});
