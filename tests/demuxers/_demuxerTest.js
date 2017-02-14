import test from 'ava';
import path from 'path';
import CRC32 from './../_crc32';

import AVBuffer from './../../src/core/buffer';
import AVDemuxer from './../../src/demuxer';
import AVDecoder from './../../src/decoder';
import AVFileSource from './../../src/sources/node/file';
import AVHTTPSource from './../../src/sources/node/http';

import AIFFDemuxer from './../../src/demuxers/aiff';
import AUDemuxer from './../../src/demuxers/au';
import CAFDemuxer from './../../src/demuxers/caf';
import M4ADemuxer from './../../src/demuxers/m4a';
import WAVEDemuxer from './../../src/demuxers/wave';

import LPCMDecoder from './../../src/decoders/lpcm';
import XLAWDecoder from './../../src/decoders/xlaw';

const demuxerTest = (name, config) =>
  test.cb(name, (t) => {
    let source;
    if (process) {
      const file = path.resolve(__dirname, `../data/${config.file}`);
      source = new AVFileSource(file);
    } else {
      source = new AVHTTPSource(`https://localhost:8181/data/${config.file}`);
    }

    source.once('data', (chunk) => {
      let demuxer;
      if (config.demuxer) {
        demuxer = new config.demuxer(source, chunk);
      } else {
        const Demuxer = AVDemuxer.find(chunk);
        demuxer = new Demuxer(source, chunk);
      }

      const expect = (config.format != null) +
                      (config.duration != null) +
                      (config.metadata != null) +
                      (config.chapters != null) +
                      (config.cookie != null) +
                      (config.data != null) +
                      (config.error != null);

      t.truthy(expect);

      if (config.format) {
        demuxer.once('format', format => t.deepEqual(format, config.format));
      }

      if (config.duration) {
        demuxer.once('duration', duration => t.is(duration, config.duration));
      }

      if (config.error) {
        demuxer.on('error', (error) => {
          t.is(error, config.error);
          t.end();
        });
      }

      if (config.cookie) {
        demuxer.on('cookie', (cookie) => {
          t.is(cookie.constructor.name, config.cookie);
          t.end();
        });
      }

      if (config.metadata) {
        demuxer.once('metadata', (metadata) => {
          // generate coverArt CRC
          if (metadata.coverArt) {
            const crc = new CRC32();
            crc.update(metadata.coverArt);
            metadata.coverArt = crc.toHex();
          }

          t.deepEqual(metadata, config.metadata);
        });
      }

      if (config.chapters) {
        demuxer.once('chapters', (chapters) => {
          t.deepEqual(chapters, config.chapters);
        });
      }

      const crc = new CRC32();
      if (config.data) {
        demuxer.on('data', (buffer) => {
          crc.update(buffer);
        });
      }

      demuxer.on('end', () => {
        if (config.data) {
          t.is(crc.toHex(), config.data);
        }
        t.end();
      });
    });

    source.start();
  });

export default demuxerTest;
