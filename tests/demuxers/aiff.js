import AIFFDemuxer from './../../src/demuxers/aiff';
import demuxerTest from './_demuxerTest';

demuxerTest('bei16', {
  file: 'aiff/bei16.aiff',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 16,
    channelsPerFrame: 2,
    bytesPerPacket: 4,
    framesPerPacket: 1,
    sampleCount: 347379,
    littleEndian: false,
    floatingPoint: false,
  },
  duration: 7877,
  data: '35da18ed',
});

demuxerTest('lei16', {
  file: 'aiff/lei16.aifc',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 16,
    channelsPerFrame: 2,
    bytesPerPacket: 4,
    framesPerPacket: 1,
    sampleCount: 347379,
    littleEndian: true,
    floatingPoint: false,
  },
  duration: 7877,
  data: 'dba3f225',
});

demuxerTest('bef32', {
  file: 'aiff/bef32.aifc',
  format: {
    formatID: 'lpcm',
    sampleRate: 44100,
    bitsPerChannel: 32,
    channelsPerFrame: 2,
    bytesPerPacket: 8,
    framesPerPacket: 1,
    sampleCount: 347379,
    littleEndian: false,
    floatingPoint: true,
  },
  duration: 7877,
  data: 'db37e290',
});

demuxerTest('alaw', {
  file: 'aiff/alaw.aifc',
  format: {
    formatID: 'alaw',
    sampleRate: 44100,
    bitsPerChannel: 8,
    channelsPerFrame: 2,
    bytesPerPacket: 2,
    framesPerPacket: 1,
    sampleCount: 347379,
    littleEndian: false,
    floatingPoint: false,
  },
  duration: 7877,
  data: 'f4b20b9b',
});

demuxerTest('Invalid AIFF due to missing FORM header', {
  file: 'au/bei16.au',
  demuxer: AIFFDemuxer,
  error: 'Invalid AIFF.',
});

demuxerTest('Invalid AIFF due to invalid file type header', {
  file: 'aiff/alaw_bad_file_type_header.aifc',
  demuxer: AIFFDemuxer,
  error: 'Invalid AIFF.',
});
