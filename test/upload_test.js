import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import {assert} from 'chai';
import * as sinon from 'sinon';
import ossOpts from './oss_options'
import testHelpers from './upload_test_helpers';

const CONTEXT = __dirname;

const assertFileMatches = testHelpers.assertFileMatches.bind(testHelpers),
      assertFileNotMatches = testHelpers.assertFileNotMatches.bind(testHelpers),
      testForFailFromStatsOrGetOSSFiles = testHelpers.testForFailFromStatsOrGetOSSFiles.bind(testHelpers),
      testForErrorsOrGetFileNames = testHelpers.testForErrorsOrGetFileNames.bind(testHelpers);

// Notes:
// I had to use a resolve for the error instead of reject
// because it would fire if an assertion failed in a .then
describe('OSS Webpack Upload', function() {
  beforeEach(testHelpers.cleanOutputDirectory);

  describe('With directory', function() {
    var ossConfig,
        config,
        randomFile,
        testOSSUpload = testHelpers.testForFailFromDirectoryOrGetOSSFiles(testHelpers.OUTPUT_PATH);

    beforeEach(function() {
      ossConfig = {directory: path.resolve(CONTEXT, '.tmp')};
      config = testHelpers.createWebpackConfig({ossConfig});

      testHelpers.createOutputPath();
      randomFile = testHelpers.createRandomFile(testHelpers.OUTPUT_PATH)
    });

    it('uploads entire directory to oss', function() {
      return testHelpers.runWebpackConfig({config})
        .then(testHelpers.testForFailFromDirectoryOrGetOSSFiles(testHelpers.OUTPUT_PATH))
        .then(assertFileMatches)
    });

    it('test upload fail will cause webpack build fail', function() {
      return testHelpers.runWebpackConfig({
        config: testHelpers.createWebpackConfig({
          ossConfig: Object.assign({}, ossConfig, {
            ossOptions: Object.assign({}, ossOpts.ossOptions, {
                accessKeySecret: 'WRONG_KEY_SECRET'
            }),
          }),
        })
      }).then(testHelpers.testForFailBuilds)
    });

    it('overwrite all files', function() {
      return testHelpers.runWebpackConfig({config})
        .then(testHelpers.testForFailFromDirectoryOrGetOSSFiles(testHelpers.OUTPUT_PATH))
        .then(assertFileMatches)
        .then(() => {
          fs.writeFileSync(randomFile.fullPath, `This is a new overwrite file - ${randomFile.fileName}`);
          return testHelpers.runWebpackConfig({config})
            .then(testHelpers.testForFailFromDirectoryOrGetOSSFiles(testHelpers.OUTPUT_PATH))
            .then(assertFileMatches)
        })
    });

    it('not overwrite random files', function() {
      return testHelpers.runWebpackConfig({config})
        .then(testHelpers.testForFailFromDirectoryOrGetOSSFiles(testHelpers.OUTPUT_PATH))
        .then(assertFileMatches)
        .then(() => {
          fs.writeFileSync(randomFile.fullPath, `This is a new overwrite file - ${randomFile.fileName}`);
          config = testHelpers.createWebpackConfig({
            ossConfig: _.merge({ overwrite: false }, ossConfig)
          });
          return testHelpers.runWebpackConfig({config})
            .then(() => {
              return testHelpers.getBuildFilesFromOSS([randomFile.fileName]);
            })
            .then(assertFileNotMatches)
        })
    });

    it('uploads directory recursivly to oss', function() {
      const createPath = (...fPath) => path.resolve(testHelpers.OUTPUT_PATH, ...fPath);

      testHelpers.createFolder(createPath('deeply', 'nested', 'folder'));
      testHelpers.createFolder(createPath('deeply', 'nested', 'folder2'));
      testHelpers.createFolder(createPath('deeply', 'nested2'));

      testHelpers.createRandomFile(createPath('deeply'));
      testHelpers.createRandomFile(createPath('deeply', 'nested'));
      testHelpers.createRandomFile(createPath('deeply', 'nested', 'folder'));
      testHelpers.createRandomFile(createPath('deeply', 'nested', 'folder2'));
      testHelpers.createRandomFile(createPath('deeply', 'nested', 'folder2'));
      testHelpers.createRandomFile(createPath('deeply', 'nested2'));

      return testHelpers.runWebpackConfig({config})
        .then(testOSSUpload)
        .then(assertFileMatches);
    })
  });

  describe('Without Directory', function() {
    it('uploads build to oss', function() {
      var randomFile,
          config = testHelpers.createWebpackConfig();

      testHelpers.createOutputPath();
      randomFile = testHelpers.createRandomFile(testHelpers.OUTPUT_PATH);

      return testHelpers.runWebpackConfig({config})
        .then(testForFailFromStatsOrGetOSSFiles)
        .then(assertFileMatches)
        .then(() => testHelpers.fetch(testHelpers.OSS_URL + randomFile.fileName))
        .then(fileBody => assert.match(fileBody, testHelpers.OSS_ERROR_REGEX, 'random file exists'));
    });

    it('uploads build to oss with basePath', function() {
      const BASE_PATH = 'test';
      const ossConfig = {basePath : BASE_PATH};

      var randomFile,
          config = testHelpers.createWebpackConfig({ossConfig});

      testHelpers.createOutputPath();
      randomFile = testHelpers.createRandomFile(testHelpers.OUTPUT_PATH);

      return testHelpers.runWebpackConfig({config})
        .then(testForErrorsOrGetFileNames)
        .then(() => testHelpers.fetch(`${testHelpers.OSS_URL}${BASE_PATH}/${randomFile.fileName}`))
        .then(fileBody => assert.match(fileBody, testHelpers.OSS_ERROR_REGEX, 'random file exists'));
    })
  });

  describe('basePathTransform', function() {
    it('can transform base path with promise', function() {
      var NAME_PREFIX = 'TEST112233',
          BASE_PATH = 'test';
      var ossConfig = {
        basePath: BASE_PATH,
        basePathTransform(basePath) {
          return Promise.resolve(basePath + NAME_PREFIX)
        }
      };
      var config = testHelpers.createWebpackConfig({ossConfig});

      return testHelpers.runWebpackConfig({config})
        .then(testForErrorsOrGetFileNames)
        .then(fileNames => _.filter(fileNames, fileName => /\.js/.test(fileName)))
        .then(([fileName]) => {
          return Promise.all([
            testHelpers.readFileFromOutputDir(fileName),
            testHelpers.fetch(`${testHelpers.OSS_URL}${BASE_PATH}/${NAME_PREFIX}/${fileName}`)
          ])
        })
        .then(([localFile, remoteFile]) => assert.equal(remoteFile, localFile, 'basepath and prefixes added'))
    });

    it('can transform base path without promise', function() {
      var NAME_PREFIX = 'TEST112233',
          BASE_PATH = 'test';
      var ossConfig = {
        basePath: BASE_PATH,
        basePathTransform(basePath) {
          return basePath + NAME_PREFIX
        }
      };
      var config = testHelpers.createWebpackConfig({ossConfig});

      return testHelpers.runWebpackConfig({config})
        .then(testForErrorsOrGetFileNames)
        .then(fileNames => _.filter(fileNames, fileName => /\.js/.test(fileName)))
        .then(([fileName]) => {
          return Promise.all([
            testHelpers.readFileFromOutputDir(fileName),
            testHelpers.fetch(`${testHelpers.OSS_URL}${BASE_PATH}/${NAME_PREFIX}/${fileName}`)
          ])
        })
        .then(([localFile, remoteFile]) => assert.equal(remoteFile, localFile, 'basepath and prefixes added'))
    })
  });

  describe('transformFilePath', function() {
    it('can transform file path', function() {
      var TRANS_PATH = 'TRANSFORM_FILE_PATH',
        BASE_PATH = 'test';
      var ossConfig = {
        basePath: BASE_PATH,
        transformFilePath(basePath, filePath) {
          if (/\.js$/.test(filePath)) {
            return Promise.resolve(path.join(basePath, TRANS_PATH, filePath))
          } else {
            return Promise.resolve(path.join(basePath, filePath))
          }
        }
      };
      var config = testHelpers.createWebpackConfig({ossConfig})

      return testHelpers.runWebpackConfig({config})
      .then(testForErrorsOrGetFileNames)
      .then(fileNames => _.filter(fileNames, fileName => /\.js/.test(fileName)))
      .then(([fileName]) => {
        return Promise.all([
          testHelpers.readFileFromOutputDir(fileName),
          testHelpers.fetch(`${testHelpers.OSS_URL}${BASE_PATH}/${TRANS_PATH}/${fileName}`)
        ])
      })
      .then(([localFile, remoteFile]) => assert.equal(remoteFile, localFile, 'file path transformed'))
    });
  });

  it('excludes files from `exclude` property', function() {
    testHelpers.createOutputPath();

    var randomFiles = [
      testHelpers.createRandomFile(testHelpers.OUTPUT_PATH),
      testHelpers.createRandomFile(testHelpers.OUTPUT_PATH)
    ];
    var excludeRegex = new RegExp(`${_.map(randomFiles, 'fileName').join('|')}`);
    var ossConfig = {
      exclude: excludeRegex
    };
    var excludeFilter = ({name}) => excludeRegex.test(name);

    var config = testHelpers.createWebpackConfig({ossConfig});

    return testHelpers.runWebpackConfig({config})
      .then(testForFailFromStatsOrGetOSSFiles)
      .then(assertFileMatches)
      .then((files) => {
        var fFiles = files.filter(excludeFilter);

        for (let {name, actual} of fFiles)
          assert.match(actual, testHelpers.OSS_ERROR_REGEX, `Excluded File ${name} Exists in OSS`)
      })
  });

  it('allows functions to be used for "ossUploadOptions"', function() {
    const headers = sinon.spy(() => null);

    var ossConfig = {
      ossUploadOptions: {headers}
    };

    var config = testHelpers.createWebpackConfig({ossConfig});

    return testHelpers.runWebpackConfig({config})
      .then(testForFailFromStatsOrGetOSSFiles)
      .then(() => sinon.assert.called(headers))
  })
});
