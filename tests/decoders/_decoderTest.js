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

const decoderTest = (name, config) =>
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

      demuxer.once('format', (format) => {
        const Decoder = AVDecoder.find(format.formatID);
        const decoder = new Decoder(demuxer, format);
        const crc = new CRC32();

        decoder.on('data', (data_chunk) => {
          crc.update(new AVBuffer(new Uint8Array(data_chunk.buffer)));
        });

        if (config.error) {
          decoder.on('error', (error) => {
            t.is(error, config.error);
          });
        }

        decoder.on('end', () => {
          if (!config.error) {
            t.is(crc.toHex(), config.data);
          }
          t.end();
        });

        function read() {
          while (decoder.decode()) {
            continue;
          }
          decoder.once('data', read);
        }

        read();
      });
    });

    source.start();
  });

export default decoderTest;
