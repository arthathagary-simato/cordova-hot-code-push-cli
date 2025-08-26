(function(){
  var path = require('path'),
      prompt = require('prompt'),
      build = require('./build.js').execute,
      fs = require('fs'),
      Q = require('q'),
      _ = require('lodash'),
      AWS = require('aws-sdk'),
      readdirp = require('readdirp'),
      loginFile = path.join(process.cwd(), '.chcplogin');

  module.exports = {
    execute: execute
  };

  function execute(context) {
    var executeDfd = Q.defer();

    build(context).then(function(){
      deploy(context).then(function(){
        executeDfd.resolve();
      });
    });

    return executeDfd.promise;
  }

  function deploy(context) {
    var executeDfd = Q.defer(),
        config,
        credentials,
        ignore = context.ignoredFiles;

    try {
      config = fs.readFileSync(context.defaultConfig, 'utf8');
      config = JSON.parse(config);
    } catch(e) {
      console.log('Cannot parse cordova-hcp.json. Did you run cordova-hcp init?');
      process.exit(0);
    }
    if(!config) {
      console.log('You need to run "cordova-hcp init" before you can run "cordova-hcp login".');
      console.log('Both commands needs to be invoked in the root of the project directory.');
      process.exit(0);
    }
    try {
      credentials = fs.readFileSync(loginFile, 'utf8');
      credentials = JSON.parse(credentials);
    } catch(e) {
      console.log('Cannot parse .chcplogin: ', e);
    }
    if(!credentials) {
      console.log('You need to run "cordova-hcp login" before you can run "cordova-hcp deploy".');
      process.exit(0);
    }

    ignore = ignore.filter( ignoredFile => !ignoredFile.match(/^chcp/) )
    ignore = ignore.map( ignoredFile => `!${ignoredFile}` )

    // console.log('Credentials: ', credentials);
    // console.log('Config: ', config);
    // console.log('Ignore: ', ignore);

    var files = readdirp({
      root: context.sourceDirectory,
      fileFilter: ignore
    });

    // Configure AWS
    AWS.config.update({
      accessKeyId: credentials.key,
      secretAccessKey: credentials.secret,
      region: config.s3region
    });
    
    var s3 = new AWS.S3();
    var uploadPromises = [];

    files.on('data', function(entry) {
      var fileKey = config.s3prefix ? path.posix.join(config.s3prefix, entry.path) : entry.path;
      var fileContent = fs.readFileSync(entry.fullPath);
      
      var uploadParams = {
        Bucket: config.s3bucket,
        Key: fileKey,
        Body: fileContent,
        ACL: 'public-read',
        CacheControl: 'no-cache, no-store, must-revalidate',
        Expires: new Date(0)
      };

      var uploadPromise = s3.upload(uploadParams).promise()
        .then(function(data) {
          console.log("Updated " + entry.fullPath + ' -> ' + data.Location);
        })
        .catch(function(err) {
          console.error("Failed to upload " + entry.fullPath + ":", err);
          throw err;
        });
      
      uploadPromises.push(uploadPromise);
    });

    files.on('end', function() {
      console.log('Deploy started');
      Promise.all(uploadPromises)
        .then(function() {
          console.log("Deploy done");
          executeDfd.resolve();
        })
        .catch(function(err) {
          console.error("unable to sync:", err);
          executeDfd.reject();
        });
    });

    files.on('error', function(err) {
      console.error("unable to sync:", err.stack);
      executeDfd.reject();
    });
    return executeDfd.promise;
  }
})();
