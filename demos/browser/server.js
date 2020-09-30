// Copyright 2019-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const compression = require('compression');
const fs = require('fs');
const http = require('http');
const url = require('url');
const { v4: uuidv4 } = require('uuid');
const {exec} = require('child_process');
const lambda = new AWS.Lambda();
require('events').EventEmitter.prototype._maxListeners = Infinity;
const { metricScope } = require("aws-embedded-metrics");
let lock = false;
AWS.config.region = 'us-east-1';
const cloudWatch = new AWS.CloudWatch({
  apiVersion: '2010-08-01'
});
const cloudWatchClient = new AWS.CloudWatchLogs({
  apiVersion: '2014-03-28'
});
const cloudwatchlogs = new AWS.CloudWatchLogs({
  apiVersion: '2014-03-28'
});
const s3 = new AWS.S3({
  apiVersion: '2006-03-01'
});

// Store created meetings in a map so attendees can join by meeting title
const meetingTable = {};

// Use local host for application server
const host = '127.0.0.1:8080';

// Load the contents of the web application to be used as the index page
const indexPage = fs.readFileSync(`dist/${process.env.npm_config_app || 'meetingV2'}.html`);

// Create ans AWS SDK Chime object. Region 'us-east-1' is currently required.
// Use the MediaRegion property below in CreateMeeting to select the region
// the meeting is hosted in.
const chime = new AWS.Chime({ region: 'us-east-1' });

// Set the AWS SDK Chime endpoint. The global endpoint is https://service.chime.aws.amazon.com.
chime.endpoint = new AWS.Endpoint(process.env.ENDPOINT || 'https://service.chime.aws.amazon.com');

// Start an HTTP server to serve the index page and handle meeting actions
http.createServer({}, async (request, response) => {
  log(`${request.method} ${request.url} BEGIN`);
  try {
    // Enable HTTP compression
    compression({})(request, response, () => {});
    const requestUrl = url.parse(request.url, true);
   // let requestBody = [];

    let rBody = '';
    const logGroupName = 'ChimeBrowserLogs1';
    const requestBody = await new Promise((resolve, reject) => {
      let requestBody = '';
      request.on('error', (err) => {
        console.error(err);
      }).on('data', (chunk) => {
        rBody = chunk.toString();

      }).on('end', () => {
        requestBody += rBody;
        console.log('requestBody 1111 ', requestBody);
        resolve(requestBody);
        // At this point, we have the headers, method, url and body, and can now
        // do whatever we need to in order to respond to this request.
      });
    });
    console.log('requestBody 22222 ', requestBody);
    if (requestUrl.pathname === '/logs') {
      await logsEndpoint(logGroupName, requestBody, response);
    } else if (requestUrl.pathname === '/create_log_stream') {

      console.log('22222 2223333 JDYDH  HSD ASH LD jfurjfi  sadfhdsf jhasdf ', requestBody);
      console.log('22222 2223333 JDYDH  HSD ASH LD jfurjfi  sadfhdsf jhasdf ', requestUrl.query.attendeeId);

      const body = JSON.parse(requestBody);
      if (!body.meetingId || !body.attendeeId) {
        throw new Error('Need parameters: meetingId, attendeeId');
      }

      //const cloudwatchlogs = new AWS.CloudWatchLogs({apiVersion: '2014-03-28'});
      // var params = {
      //   logGroupName: logGroupName
      // };
      // await cloudwatchlogs.createLogGroup(params).promise();
      const logStreamName = `ChimeSDKMeeting_${body.meetingId.toString()}_${body.attendeeId.toString()}`;
      console.log(logStreamName);
      await cloudwatchlogs.createLogStream({
        logGroupName: logGroupName,
        logStreamName: logStreamName,
      }).promise();
      respond(response, 200, 'application/json', JSON.stringify({}));
    } else if (requestUrl.pathname === '/send_metrics') {
      const body = JSON.parse(requestBody);
      const meetingId = body.mId;
      const attendeeId = body.aId;
      const instanceId = body.iId;
      const startTime = body.ltStartTime;
      const metricBody = body.metricBody;
      console.log('body 0000', body);
      console.log('body 0000', typeof body);
      console.log('metricBody 0000', typeof metricBody);
      console.log('metricBody  000', metricBody);
      for (const [metricName, metricValue] of Object.entries(metricBody)) {
        console.log(`Emitting metric: ${metricName} : ` + metricValue);
        addToCloudWatchMetrics(meetingId, attendeeId, instanceId, startTime, metricName, metricValue);
      }
      respond(response, 200, 'application/json', JSON.stringify({}));

    } else if (requestUrl.pathname === '/send_status') {
      const body = JSON.parse(requestBody);
      const instanceId = body.iId;
      const startTime = body.ltStartTime;
      const metricName = body.metricName;
      const metricValue = body.metricValue;
      console.log('metricName 0000', metricName);
      console.log('metricName 0000', typeof metricName);
      console.log('metricValue 0000', typeof metricValue);
      console.log('metricValue  000', metricValue);

      console.log(`Emitting metric: ${metricName} : ` + metricValue);
      addStatusToCloudWatchMetrics(instanceId, startTime, metricName, metricValue);

      respond(response, 200, 'application/json', JSON.stringify({}));

    } else if (requestUrl.pathname === '/get_load_test_status') {
      console.log('asjdfhlkasdfh awdf ah sdflkjasdfh ');
      const s3 = new AWS.S3({apiVersion: '2006-03-01'});
      var getParams = {
        Bucket: 'chimesdkmeetingsloadtest',
        Key: 'src/configs/LoadTestStatus.json'
      };
      console.log('11111');
      try {
        console.log('2222222');

        const data = await s3.getObject(getParams).promise();
        console.log('333333');

        const loadTestStatus = data.Body.toString('utf-8');
        console.log('444444');

        respond(response, 200, 'application/json', loadTestStatus);
      } catch (err) {
        console.error('Could not read status: ', err);
        respond(response, 400, 'application/json', JSON.stringify({}));
      }
    } else if (request.method === 'GET' && requestUrl.pathname === '/') {
      // Return the contents of the index page
      respond(response, 200, 'text/html', indexPage);
    } else if (process.env.DEBUG && request.method === 'POST' && requestUrl.pathname === '/join') {
      // For internal debugging - ignore this.
      respond(response, 201, 'application/json', JSON.stringify(require('./debug.js').debug(requestUrl.query), null, 2));
    } else if (request.method === 'POST' && requestUrl.pathname === '/join') {
      if (!requestUrl.query.title || !requestUrl.query.name || !requestUrl.query.region) {
        throw new Error('Need parameters: title, name, region');
      }

      // Look up the meeting by its title. If it does not exist, create the meeting.
      if (!meetingTable[requestUrl.query.title]) {
        meetingTable[requestUrl.query.title] = await chime.createMeeting({
          // Use a UUID for the client request token to ensure that any request retries
          // do not create multiple meetings.
          ClientRequestToken: uuidv4(),
          // Specify the media region (where the meeting is hosted).
          // In this case, we use the region selected by the user.
          MediaRegion: requestUrl.query.region,
          // Any meeting ID you wish to associate with the meeting.
          // For simplicity here, we use the meeting title.
          ExternalMeetingId: requestUrl.query.title.substring(0, 64),
        }).promise();
      }

      // Fetch the meeting info
      const meeting = meetingTable[requestUrl.query.title];

      // Create new attendee for the meeting
      const attendee = await chime.createAttendee({
        // The meeting ID of the created meeting to add the attendee to
        MeetingId: meeting.Meeting.MeetingId,

        // Any user ID you wish to associate with the attendeee.
        // For simplicity here, we use a random id for uniqueness
        // combined with the name the user provided, which can later
        // be used to help build the roster.
        ExternalUserId: `${uuidv4().substring(0, 8)}#${requestUrl.query.name}`.substring(0, 64),
      }).promise()

      // Return the meeting and attendee responses. The client will use these
      // to join the meeting.
      respond(response, 201, 'application/json', JSON.stringify({
        JoinInfo: {
          Meeting: meeting,
          Attendee: attendee,
        },
      }, null, 2));
    } else if (request.method === 'POST' && requestUrl.pathname === '/end') {
      // End the meeting. All attendee connections will hang up.
      await chime.deleteMeeting({
        MeetingId: meetingTable[requestUrl.query.title].Meeting.MeetingId,
      }).promise();
      respond(response, 200, 'application/json', JSON.stringify({}));
    } else {
      respond(response, 404, 'text/html', '404 Not Found');
    }
  } catch (err) {
    console.log('jmghdgfd gd hgfdgvh ' + err);
    respond(response, 400, 'application/json', JSON.stringify({ error: err.message }, null, 2));
  }
  log(`${request.method} ${request.url} END`);
}).listen(host.split(':')[1], host.split(':')[0], () => {
  log(`server running at http://${host}/`);
});

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
};

function respond(response, statusCode, contentType, body) {
  try {

    if (lock === false) {
      lock = true;
      response.statusCode = statusCode;
      response.setHeader('Content-Type', contentType);
      response.end(body);
      if (contentType === 'application/json') {
        log(body);
      }
    }
  } catch (err) {

  } finally {
    lock = false;
  }
}

function addToCloudWatchMetrics(meetingId, attendeeId, instanceId, startTime, metricName, metricValue) {
  const putMetric =
    metricScope(metrics => async (meetingId, attendeeId, instanceId, startTime, metricName, metricValue) => {
      console.log("received message");
      metrics.putDimensions({MId: meetingId, AId: attendeeId, IId: instanceId, StartTime: startTime.toLocaleString()});
      metrics.putMetric(metricName, metricValue);

      console.log("completed aggregation successfully.");
    });
  putMetric(meetingId, attendeeId, instanceId, startTime, metricName, metricValue);
}

function addStatusToCloudWatchMetrics(instanceId, startTime, metricName, metricValue) {
  const putMetric =
    metricScope(metrics => async (instanceId, startTime, metricName, metricValue) => {
      console.log("received message");
      metrics.putDimensions({IId: instanceId, StartTime: startTime.toLocaleString()});
      metrics.putMetric(metricName, metricValue);

      console.log("completed aggregation successfully.");
    });
  putMetric(instanceId, startTime, metricName, metricValue);
}

async function logsEndpoint(logGroupName, requestBody, response) {
  console.log('requestBody');
  console.log(requestBody);

  let isJSONString = true;
  let jsonLogMessage = null;
  try {
    if (requestBody === null || requestBody === '') {
      isJSONString = false;
    }
    jsonLogMessage = JSON.parse(requestBody);
    isJSONString = (typeof jsonLogMessage === 'object');
  } catch (e) {
    isJSONString = false;
  }

  if(!isJSONString || jsonLogMessage === null){
    return;
  }
  const body = jsonLogMessage;
  console.log('Bodyyyy 0000 ', body);
  console.log('Bodyyyy 09876543 ', typeof body)
  console.log('Bodyyyy 1111 ', body.meetingId)
  console.log('Bodyyyy 2222 ', body.attendeeId)
  if (!body.logs || !body.meetingId || !body.attendeeId || !body.appName) {
    respond(response, 400, 'application/json', JSON.stringify({error: 'Need properties: logs, meetingId, attendeeId, appName'}));
  } else if (body.logs.length === 0) {
    respond(response, 200, 'application/json', JSON.stringify({ret: 'Empty'}));
  }

  const logStreamName = `ChimeSDKMeeting_${body.meetingId.toString()}_${body.attendeeId.toString()}`;
  const putLogEventsInput = {
    logGroupName: logGroupName,
    logStreamName: logStreamName
  };
  const uploadSequence = await ensureLogStream(logStreamName, logGroupName);
  if (uploadSequence) {
    putLogEventsInput.sequenceToken = uploadSequence;
  }
  const logEvents = [];

  for (let i = 0; i < body.logs.length; i++) {
    const log = body.logs[i];
    // console.log(' log : ', typeof log, log);
    // console.log(' logMessage : ', typeof log.message, log.message);
    // console.log(' logMessage True/False: ', typeof log.message === 'object');
    // console.log('dddd ', log.message);
    // // let isJSONString = false;
    // // let jsonLogMessage = null;
    // // try {
    // //   if (log.message === null || log.message === '') {
    // //     isJSONString = false;
    // //   }
    // //   jsonLogMessage = JSON.parse(log.message);
    // //   isJSONString = (typeof jsonLogMessage === 'object');
    // // } catch (e) {
    // //   isJSONString = false;
    // // }
    // console.log('Bodyyyy 0000 1111', body)
    // console.log('Bodyyyy 09876543 11111', typeof body)
    // console.log('Bodyyyy 1111 1111', body.meetingId)
    // console.log('Bodyyyy 2222 11111', body.attendeeId)
    // if (isJSONString && jsonLogMessage !== null) {
    //   console.log(typeof jsonLogMessage, ' jsonLogMessage 000 ', jsonLogMessage);
    //   console.log(jsonLogMessage.audioPacketsReceived, typeof jsonLogMessage.audioPacketsReceived);
    //   console.log(jsonLogMessage.audioPacketsReceived !== null);
    //   let metricData = [];
    //   if ((jsonLogMessage.audioPacketsReceived && jsonLogMessage.audioPacketsReceived !== null)) {
    //
    //     try {
    //       console.log('Bodyyyy 0000 22222', body)
    //       console.log('Bodyyyy 09876543 22222', typeof body)
    //       console.log('Bodyyyy 1111 22222', body.meetingId)
    //       console.log('Bodyyyy 2222 2222', body.attendeeId)
    //       console.log('jsonLogMessage 1111 ', jsonLogMessage);
    //       // const metricDataLocal =  putMetricData(jsonLogMessage, body.meetingId.toString(), body.attendeeId.toString());
    //       // console.log('jsonLogMessage 11112222 ', metricDataLocal);
    //       // for (let data = 0; data < metricDataLocal.length; data += 1) {
    //       //   metricData.push(metricDataLocal[data]);
    //       // }
    //       console.log('jsonLogMessage 2222 ', jsonLogMessage);
    //
    //     } catch (ex) {
    //       console.error('jsonLogMessage 3333 ', ex);
    //     }
    //   } else {
    //     try {
    //       console.log('jsonLogMessage 0000  444 ', jsonLogMessage);
    //       metricData.push( putMeetingStatusMetricData(jsonLogMessage));
    //       console.log('jsonLogMessage 0000 5555 ', jsonLogMessage);
    //     } catch (ex) {
    //       console.error('jsonLogMessage 0000 666 ', ex);
    //     }
    //   }
    //
    //   const namespace = 'AlivePing';
    //   var params = {
    //     MetricData: metricData,
    //     Namespace: namespace
    //   };
    //   console.log('try block', metricData);
    //   if (metricData.length > 0) {
    //     console.log('metric Data0000 ' + metricData.length);
    //     console.log(metricData);
    //     //publishMetricToCloudWatch(params);
    //   }

    // }
    const timestamp = new Date(log.timestampMs).toISOString();
    const message = `${timestamp} [${log.sequenceNumber}] [${log.logLevel}] [meeting: ${body.meetingId.toString()}] [attendee: ${body.attendeeId}]: ${log.message}`;
    logEvents.push({
      message: message,
      timestamp: log.timestampMs
    });
  }

  try {
    if(logEvents.length > 1) {
      putLogEventsInput.logEvents = logEvents;
      cloudWatchClient.putLogEvents(putLogEventsInput).promise();
    }
  } catch (error) {
    const errorMessage = `Failed to put CloudWatch log events with error ${error} and params ${JSON.stringify(putLogEventsInput)}`;
    if (error.code === 'InvalidSequenceTokenException' || error.code === 'DataAlreadyAcceptedException') {
      console.warn(errorMessage);
    } else {
      console.error(errorMessage);
    }
  }
  respond(response,200, 'application/json', JSON.stringify({ret: 200}));
}

async function ensureLogStream(logStreamName, logGroupName) {
  const logStreamsResult = await cloudWatchClient.describeLogStreams({
    logGroupName: logGroupName,
    logStreamNamePrefix: logStreamName,
  }).promise();
  const foundStream = logStreamsResult.logStreams.find(s => s.logStreamName === logStreamName);
  if (foundStream) {
    return foundStream.uploadSequenceToken;
  }
  await cloudWatchClient.createLogStream({
    logGroupName: logGroupName,
    logStreamName: logStreamName,
  }).promise();
  return null;
}

 function putMeetingStatusMetricData(messageJson) {
  const instanceId = String(messageJson.instanceId);
  const meetingId = String(messageJson.meetingId);
  const attendeeId = String(messageJson.attendeeId);
  let metricName = '';
  let metricValue = 0;
  console.log('messageJson sssss', messageJson);
  if (messageJson.MeetingJoin !== undefined) {
    metricName = 'MeetingJoin';
    metricValue = messageJson[metricName];
  } else if (messageJson.MeetingLeave !== undefined) {
    metricName = 'MeetingLeave';
    metricValue = messageJson[metricName];
  } else if (messageJson.alivePing !== undefined) {
    metricName = 'alivePing';
    metricValue = messageJson[metricName];
  } else if (messageJson.PongReceived !== undefined) {
    metricName = 'PongReceived';
    metricValue = messageJson[metricName];
  } else if (messageJson.StatusCode !== undefined) {
    metricName = 'StatusCode-' + messageJson['StatusCode'];
    metricValue = 1;
  } else if (messageJson.MeetingStarted !== undefined) {
    metricName = 'MeetingStarted';
    metricValue = messageJson[metricName];
  } else if (messageJson.ReconnectingMeeting !== undefined) {
    metricName = 'ReconnectingMeeting';
    metricValue = messageJson[metricName];
  } else if (messageJson.ConnectingMeeting !== undefined) {
    metricName = 'ConnectingMeeting';
    metricValue = messageJson[metricName];
  }

  console.log(instanceId, `Emitting metric: ${metricName} --> ${metricValue} : `);
  const data = new Date().toISOString() + ' ' + meetingId + '_' + attendeeId + ' ' + JSON.stringify(messageJson);
  console.log('data_1 0000 ', data);

  writeToFile(data, meetingId, instanceId);
  console.log('data_1 11111 ', data);

  return {
    MetricName: metricName,
    Dimensions: [{
      Name: 'Instance',
      Value: instanceId
    }],
    Timestamp: new Date().toISOString(),
    Value: metricValue
  };
}


function putMetricData(messageJson, meetingId, attendeeId) {
  const instanceId = messageJson.instanceId;
  const loadTestStartTime = messageJson.loadTestStartTime;
  console.log('instanceId... ' + instanceId);
  console.log('loadTestStartTime... ' + loadTestStartTime);
  console.log('loadMsg... ' + messageJson);
  delete messageJson.instanceId;
  delete messageJson.loadTestStartTime;

  const dimensions = [
    {
      Name: 'MeetingId',
      Value: meetingId
    },
    {
      Name: 'AttendeeId',
      Value: attendeeId
    },
    {
      Name: 'Instance',
      Value: instanceId
    },
    {
      Name: 'LoadTestStartTime',
      Value: loadTestStartTime.toLocaleString()
    }
  ];

  //console.log(`Emitting metric: ${namespace} / meetingActive : ` + 1);
  delete messageJson.availableSendBandwidth;

  const data = new Date().toISOString() + ' ' + meetingId + '_' + attendeeId + ' ' + JSON.stringify(messageJson);
  console.log('data_1 33333 ', data);

  //writeToFile(data, meetingId, instanceId);
  console.log('data_1 44444 ', data);
  //transferFileToS3('ClientMetric_' + meetingId + '_' + instanceId);

  const metricData = [];
  for (const [metricName, metricValue] of Object.entries(messageJson)) {
    console.log(`Emitting metric: ${metricName} : ` + metricValue);
    metricData.push({
      MetricName: metricName,
      Dimensions: dimensions,
      Timestamp: new Date().toISOString(),
      Value: metricValue
    });
  }
  return metricData;

}

async function publishMetricToCloudWatch(params) {
  try {
    console.log('params', params);
    let res = await cloudWatch.putMetricData(params).promise();
    if (res !== null) {
      console.log('putMetricData successful ', res);
    } else {
      console.log('putMetricData failed ', res);
    }
  } catch (error) {
    console.error(`Unable to emit metric: ${error}`)
  }
}

async function writeToFile (data, meetingId, instanceId) {
  const filename = 'ClientMetric_' + meetingId + '_' + instanceId;
  console.log('filename_1 0000 ' + filename);
  fs.appendFile(filename, data+'\n', function (err) {
    if (err) throw err;
  });
}

function transferFileToS3(fileToUpload) {
  exec(`aws s3api put-object --bucket chimesdkmeetingsloadtest --key ClientMetric/`);
  exec(`aws s3 cp ${fileToUpload} s3://chimesdkmeetingsloadtest/ClientMetric/ `);
}


//
//
// async function logsEndpoint(logGroupName, requestBody, response) {
//   console.log('requestBody');
//   console.log(requestBody);
//   const body = JSON.parse(requestBody);
//   if (!body.logs || !body.meetingId || !body.attendeeId || !body.appName) {
//     respond(response, 400, 'application/json', JSON.stringify({error: 'Need properties: logs, meetingId, attendeeId, appName'}));
//   } else if (body.logs.length === 0) {
//     respond(response, 200, 'application/json', JSON.stringify({}));
//   }
//
//   const logStreamName = `ChimeSDKMeeting_${body.meetingId.toString()}_${body.attendeeId.toString()}`;
//   const putLogEventsInput = {
//     logGroupName: logGroupName,
//     logStreamName: logStreamName
//   };
//   const uploadSequence = await ensureLogStream(logStreamName, logGroupName);
//   if (uploadSequence) {
//     putLogEventsInput.sequenceToken = uploadSequence;
//   }
//   const logEvents = [];
//
//   for (let i = 0; i < body.logs.length; i++) {
//     const log = body.logs[i];
//     console.log(' log : ', typeof log, log);
//     console.log(' logMessage : ', typeof log.message, log.message);
//     console.log(' logMessage True/False: ', typeof log.message === 'object');
//     console.log('dddd ', log.message);
//     let isJSONString = false;
//     let jsonLogMessage = null;
//     try {
//       if (log.message === null || log.message === '') {
//         isJSONString = false;
//       }
//       jsonLogMessage = JSON.parse(log.message);
//       isJSONString = (typeof jsonLogMessage === 'object');
//     } catch (e) {
//       isJSONString = false;
//     }
//     if (isJSONString && jsonLogMessage !== null) {
//       console.log(typeof jsonLogMessage, ' jsonLogMessage 000 ', jsonLogMessage);
//       console.log(jsonLogMessage.audioPacketsReceived, typeof jsonLogMessage.audioPacketsReceived);
//       console.log(jsonLogMessage.audioPacketsReceived !== null);
//       let metricData = [];
//       if ((jsonLogMessage.audioPacketsReceived && jsonLogMessage.audioPacketsReceived !== null)) {
//
//         try {
//           console.log('jsonLogMessage 1111 ', jsonLogMessage);
//           const metricDataLocal = putMetricData(jsonLogMessage, body.meetingId, body.attendeeId);
//           console.log('jsonLogMessage 11112222 ', metricDataLocal);
//           for (let data = 0; data < metricDataLocal.length; data += 1) {
//             metricData.push(metricDataLocal[data]);
//           }
//           console.log('jsonLogMessage 2222 ', jsonLogMessage);
//
//         } catch (ex) {
//           console.error('jsonLogMessage 3333 ', ex);
//         }
//       } else {
//         try {
//           console.log('jsonLogMessage 0000  444 ', jsonLogMessage);
//           metricData.push(putMeetingStatusMetricData(jsonLogMessage));
//           console.log('jsonLogMessage 0000 5555 ', jsonLogMessage);
//         } catch (ex) {
//           console.error('jsonLogMessage 0000 666 ', ex);
//         }
//       }
//
//       //  else if ((jsonLogMessage.MeetingJoin && jsonLogMessage.MeetingJoin !== null) || (jsonLogMessage.MeetingLeave && jsonLogMessage.MeetingLeave !== null) || (jsonLogMessage.alivePing && jsonLogMessage.alivePing !== null) || (jsonLogMessage.PongReceived && jsonLogMessage.PongReceived !== null)) {
//       //   try {
//       //     console.log('jsonLogMessage 444 ', jsonLogMessage);
//       //     metricData.push(await putMeetingStatusMetricData(jsonLogMessage));
//       //     console.log('jsonLogMessage 5555 ', jsonLogMessage);
//       //   } catch (ex) {
//       //     console.error('jsonLogMessage 666 ', ex);
//       //   }
//       // }
//
//       const namespace = 'AlivePing';
//       var params = {
//         MetricData: metricData,
//         Namespace: namespace
//       };
//       console.log('try block', metricData);
//       if (metricData.length > 0) {
//         console.log('metric Data0000 ' + metricData.length);
//         console.log(metricData);
//         await publishMetricToCloudWatch(params);
//       }
//
//     }
//     const timestamp = new Date(log.timestampMs).toISOString();
//     const message = `${timestamp} [${log.sequenceNumber}] [${log.logLevel}] [meeting: ${body.meetingId.toString()}] [attendee: ${body.attendeeId}]: ${log.message}`;
//     logEvents.push({
//       message: message,
//       timestamp: log.timestampMs
//     });
//   }
//
//
//   try {
//     if(logEvents)
//     putLogEventsInput.logEvents = logEvents;
//     await cloudWatchClient.putLogEvents(putLogEventsInput).promise();
//   } catch (error) {
//     const errorMessage = `Failed to put CloudWatch log events with error ${error} and params ${JSON.stringify(putLogEventsInput)}`;
//     if (error.code === 'InvalidSequenceTokenException' || error.code === 'DataAlreadyAcceptedException') {
//       console.warn(errorMessage);
//     } else {
//       console.error(errorMessage);
//     }
//   }
//   respond(response,200, 'application/json', JSON.stringify({}));
// }
//
// function isJsonString(str) {
//   try {
//     if (str === null) {
//       return false;
//     }
//     const json = JSON.parse(str);
//     return (typeof json === 'object');
//   } catch (e) {
//     return false;
//   }
// }
//
//
// function putMeetingStatusMetricData(messageJson) {
//   const instanceId = String(messageJson.instanceId);
//   let metricName = '';
//   let metricValue = 0;
//   console.log('messageJson sssss', messageJson);
//   if (messageJson.MeetingJoin !== undefined) {
//     metricName = 'MeetingJoin';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.MeetingLeave !== undefined) {
//     metricName = 'MeetingLeave';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.alivePing !== undefined) {
//     metricName = 'alivePing';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.PongReceived !== undefined) {
//     metricName = 'PongReceived';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.StatusCode !== undefined) {
//     metricName = 'StatusCode-' + messageJson['StatusCode'];
//     metricValue = 1;
//   } else if (messageJson.MeetingStarted !== undefined) {
//     metricName = 'MeetingStarted';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.ReconnectingMeeting !== undefined) {
//     metricName = 'ReconnectingMeeting';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.ConnectingMeeting !== undefined) {
//     metricName = 'ConnectingMeeting';
//     metricValue = messageJson[metricName];
//   }
//
//   console.log(instanceId, `Emitting metric: ${metricName} --> ${metricValue} : `);
//   return {
//     MetricName: metricName,
//     Dimensions: [{
//       Name: 'Instance',
//       Value: instanceId
//     }],
//     Timestamp: new Date().toISOString(),
//     Value: metricValue
//   };
// }
//
//
// function putMetricData(messageJson, meetingId, attendeeId) {
//   const instanceId = messageJson.instanceId;
//   const loadTestStartTime = messageJson.loadTestStartTime;
//   console.log('instanceId... ' + instanceId);
//   console.log('loadTestStartTime... ' + loadTestStartTime);
//   console.log('loadMsg... ' + messageJson);
//   delete messageJson.instanceId;
//   delete messageJson.loadTestStartTime;
//
//   const dimensions = [
//     {
//       Name: 'MeetingId',
//       Value: meetingId
//     },
//     {
//       Name: 'AttendeeId',
//       Value: attendeeId
//     },
//     {
//       Name: 'Instance',
//       Value: instanceId
//     },
//     {
//       Name: 'LoadTestStartTime',
//       Value: loadTestStartTime.toLocaleString()
//     }
//   ];
//
//   //console.log(`Emitting metric: ${namespace} / meetingActive : ` + 1);
//   delete messageJson.availableSendBandwidth;
//   const metricData = [];
//   for (const [metricName, metricValue] of Object.entries(messageJson)) {
//     console.log(`Emitting metric: ${metricName} : ` + metricValue);
//     metricData.push({
//       MetricName: metricName,
//       Dimensions: dimensions,
//       Timestamp: new Date().toISOString(),
//       Value: metricValue
//     });
//   }
//   return metricData;
//
// }
//
// async function publishMetricToCloudWatch(params) {
//   try {
//     console.log('params', params);
//     let res = await cloudWatch.putMetricData(params).promise();
//     if (res !== null) {
//       console.log('putMetricData successful ', res);
//     } else {
//       console.log('putMetricData failed ', res);
//     }
//   } catch (error) {
//     console.error(`Unable to emit metric: ${error}`)
//   }
// }
//
// async function ensureLogStream(logStreamName, logGroupName) {
//   const logStreamsResult = await cloudWatchClient.describeLogStreams({
//     logGroupName: logGroupName,
//     logStreamNamePrefix: logStreamName,
//   }).promise();
//   const foundStream = logStreamsResult.logStreams.find(s => s.logStreamName === logStreamName);
//   if (foundStream) {
//     return foundStream.uploadSequenceToken;
//   }
//   await cloudWatchClient.createLogStream({
//     logGroupName: logGroupName,
//     logStreamName: logStreamName,
//   }).promise();
//   return null;
// }


// // Copyright 2019-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// // SPDX-License-Identifier: Apache-2.0
// /*
// const AWS = require('aws-sdk');
// AWS.config.region = 'us-east-1';
// const compression = require('compression');
// const fs = require('fs');
// const http = require('http');
// const url = require('url');
// const { v4: uuidv4 } = require('uuid');
// const {exec} = require('child_process');
// const lambda = new AWS.Lambda();
//
// // Store created meetings in a map so attendees can join by meeting title
// const meetingTable = {};
//
// // Use local host for application server
// const host = '127.0.0.1:8080';
//
// // Load the contents of the web application to be used as the index page
// const indexPage = fs.readFileSync(`dist/${process.env.npm_config_app || 'meetingV2'}.html`);
//
// // Create ans AWS SDK Chime object. Region 'us-east-1' is currently required.
// // Use the MediaRegion property below in CreateMeeting to select the region
// // the meeting is hosted in.
// const chime = new AWS.Chime({ region: 'us-east-1' });
//
// // Set the AWS SDK Chime endpoint. The global endpoint is https://service.chime.aws.amazon.com.
// // chime.endpoint = new AWS.Endpoint(process.env.ENDPOINT || 'https://service.chime.aws.amazon.com');
// chime.endpoint = new AWS.Endpoint( 'https://tapioca.us-east-1.amazonaws.com');
//
// // Start an HTTP server to serve the index page and handle meeting actions
// http.createServer({}, async (request, response) => {
//   log(`${request.method} ${request.url} BEGIN`);
//   try {
//
//     // collectRequestData(request, result => {
//     //   console.log(result);
//     //   response.end('Parsed data belonging to, ', result);
//     // });
//     // Enable HTTP compression
//     compression({})(request, response, () => {});
//     const requestUrl = url.parse(request.url, true);
//    // let requestBody = [];
//
//     let rBody = '';
//     const logGroupName = 'ChimeBrowserLogs2';
//     const requestBody = await new Promise((resolve, reject) => {
//       let requestBody = '';
//       request.on('error', (err) => {
//         console.error(err);
//       }).on('data', (chunk) => {
//         rBody = chunk.toString();
//
//       }).on('end', () => {
//         requestBody += rBody;
//         console.log('requestBody 1111 ', requestBody);
//         resolve(requestBody);
//         // At this point, we have the headers, method, url and body, and can now
//         // do whatever we need to in order to respond to this request.
//       });
//     });
//     console.log('requestBody 22222 ', requestBody);
//
//     if (requestUrl.pathname === '/create_log_stream') {
//
//       console.log('22222 2223333 JDYDH  HSD ASH LD jfurjfi  sadfhdsf jhasdf ', requestBody);
//       console.log('22222 2223333 JDYDH  HSD ASH LD jfurjfi  sadfhdsf jhasdf ', requestUrl.query.attendeeId);
//
//       const body = JSON.parse(requestBody);
//       if (!body.meetingId || !body.attendeeId) {
//         throw new Error('Need parameters: meetingId, attendeeId');
//       }
//
//       const cloudwatchlogs = new AWS.CloudWatchLogs({apiVersion: '2014-03-28'});
//       // var params = {
//       //   logGroupName: logGroupName
//       // };
//       // await cloudwatchlogs.createLogGroup(params).promise();
//       const logStreamName = `ChimeSDKMeeting_${body.meetingId.toString()}_${body.attendeeId.toString()}`;
//       console.log(logStreamName);
//       await cloudwatchlogs.createLogStream({
//         logGroupName: logGroupName,
//         logStreamName: logStreamName,
//       }).promise();
//       respond(response, 200, 'application/json', JSON.stringify({}));
//
//     } else if (requestUrl.pathname === '/logs') {
//       await logsEndpoint(logGroupName, requestBody, response);
//
//
//     }
//
//     if (request.method === 'GET' && requestUrl.pathname === '/') {
//       // Return the contents of the index page
//       respond(response, 200, 'text/html', indexPage);
//     } else if (process.env.DEBUG && request.method === 'POST' && requestUrl.pathname === '/join') {
//       // For internal debugging - ignore this.
//       respond(response, 201, 'application/json', JSON.stringify(require('./debug.js').debug(requestUrl.query), null, 2));
//     } else if (requestUrl.pathname === '/get_load_test_status') {
//
//       console.log('asjdfhlkasdfh awdf ah sdflkjasdfh ');
//       const s3 = new AWS.S3({apiVersion: '2006-03-01'});
//       var getParams = {
//         Bucket: 'chimesdkmeetingsloadtest',
//         Key: 'src/configs/LoadTestStatus.json'
//       };
//       console.log('11111');
//       try {
//         console.log('2222222');
//
//         const data = await s3.getObject(getParams).promise();
//         console.log('333333');
//
//         const loadTestStatus = data.Body.toString('utf-8');
//         console.log('444444');
//
//         respond(response, 200, 'application/json', loadTestStatus);
//       } catch(err) {
//         console.error('Could not read status: ', err);
//         respond(response, 400, 'application/json', JSON.stringify({}));
//       }
//     } else if (request.method === 'POST' && requestUrl.pathname === '/join') {
//       if (!requestUrl.query.title || !requestUrl.query.name || !requestUrl.query.region) {
//         throw new Error('Need parameters: title, name, region');
//       }
//
//       // Look up the meeting by its title. If it does not exist, create the meeting.
//       if (!meetingTable[requestUrl.query.title]) {
//         meetingTable[requestUrl.query.title] = await chime.createMeeting({
//           // Use a UUID for the client request token to ensure that any request retries
//           // do not create multiple meetings.
//           ClientRequestToken: uuidv4(),
//           // Specify the media region (where the meeting is hosted).
//           // In this case, we use the region selected by the user.
//           MediaRegion: requestUrl.query.region,
//           // Any meeting ID you wish to associate with the meeting.
//           // For simplicity here, we use the meeting title.
//           ExternalMeetingId: requestUrl.query.title.substring(0, 64),
//         }).promise();
//       }
//
//       // Fetch the meeting info
//       const meeting = meetingTable[requestUrl.query.title];
//
//       // Create new attendee for the meeting
//       const attendee = await chime.createAttendee({
//         // The meeting ID of the created meeting to add the attendee to
//         MeetingId: meeting.Meeting.MeetingId,
//
//         // Any user ID you wish to associate with the attendeee.
//         // For simplicity here, we use a random id for uniqueness
//         // combined with the name the user provided, which can later
//         // be used to help build the roster.
//         ExternalUserId: `${uuidv4().substring(0, 8)}#${requestUrl.query.name}`.substring(0, 64),
//       }).promise()
//
//       // Return the meeting and attendee responses. The client will use these
//       // to join the meeting.
//       respond(response, 201, 'application/json', JSON.stringify({
//         JoinInfo: {
//           Meeting: meeting,
//           Attendee: attendee,
//         },
//       }, null, 2));
//     } else if (request.method === 'POST' && requestUrl.pathname === '/end') {
//       // End the meeting. All attendee connections will hang up.
//       await chime.deleteMeeting({
//         MeetingId: meetingTable[requestUrl.query.title].Meeting.MeetingId,
//       }).promise();
//       const cmd = `aws cloudwatch put-metric-data --metric-name 'DeleteMeeting' --dimensions Instance=\`curl http://169.254.169.254/latest/meta-data/instance-id\`  --namespace 'AlivePing' --value 1`;
//       exec(cmd);
//       respond(response, 200, 'application/json', JSON.stringify({}));
//     } else {
//       respond(response, 404, 'text/html', '404 Not Found');
//     }
//   } catch (err) {
//     //respond(response, 400, 'application/json', JSON.stringify({ error: err.message }, null, 2));
//   }
//   log(`${request.method} ${request.url} END`);
// }).listen(host.split(':')[1], host.split(':')[0], () => {
//   log(`server running at http://${host}/`);
// });
//
// function log(message) {
//   console.log(`${new Date().toISOString()} ${message}`);
// };
//
// function respond(response, statusCode, contentType, body) {
//   response.statusCode = statusCode;
//   response.setHeader('Content-Type', contentType);
//   response.end(body);
//   if (contentType === 'application/json') {
//     log(body);
//   }
// }
//
//
//
//
// async function logsEndpoint(logGroupName, requestBody, response) {
//   console.log('requestBody');
//   console.log(requestBody);
//   const body = JSON.parse(requestBody);
//   if (!body.logs || !body.meetingId || !body.attendeeId || !body.appName) {
//     respond(response,400, 'application/json', JSON.stringify({error: 'Need properties: logs, meetingId, attendeeId, appName'}));
//   } else if (!body.logs.length) {
//     respond(response,200, 'application/json', JSON.stringify({}));
//   }
//
//   const logStreamName = `ChimeSDKMeeting_${body.meetingId.toString()}_${body.attendeeId.toString()}`;
//   const cloudWatchClient = new AWS.CloudWatchLogs({apiVersion: '2014-03-28'});
//   const putLogEventsInput = {
//     logGroupName: logGroupName,
//     logStreamName: logStreamName
//   };
//   const uploadSequence = await ensureLogStream(cloudWatchClient, logStreamName, logGroupName);
//   if (uploadSequence) {
//     putLogEventsInput.sequenceToken = uploadSequence;
//   }
//   const logEvents = [];
//
//   for (let i = 0; i < body.logs.length; i++) {
//     const log = body.logs[i];
//     console.log(' log : ', typeof log, log);
//     console.log(' logMessage : ', typeof log.message, log.message);
//     console.log(' logMessage True/False: ', typeof log.message === 'object');
//     console.log('dddd ', log.message);
//     let isJSONString = false;
//     try {
//       if (log.message === null) {
//         isJSONString = false;
//       }
//       const json = JSON.parse(log.message);
//       isJSONString = (typeof json === 'object');
//     } catch (e) {
//       isJSONString = false;
//     }
//     if (isJSONString) {
//       const logMsg = JSON.parse(log.message);
//       console.log(typeof logMsg, ' logMsg 000 ', logMsg);
//       console.log(logMsg.audioPacketsReceived, typeof logMsg.audioPacketsReceived);
//       console.log(logMsg.audioPacketsReceived !== null);
//       let metricData = [];
//       if ((logMsg.audioPacketsReceived && logMsg.audioPacketsReceived !== null)) {
//
//         try {
//           console.log('logMsg 1111 ', logMsg);
//           const metricDataLocal = [1];//putMetricData(logMsg, body.meetingId, body.attendeeId);
//           console.log('logMsg 11112222 ', metricDataLocal);
//           for (let data = 0; data < metricDataLocal.length; data += 1) {
//             metricData.push(metricDataLocal[data]);
//           }
//           console.log('logMsg 2222 ', logMsg);
//
//         } catch (ex) {
//           console.error('logMsg 3333 ', ex);
//         }
//       } else {
//         try {
//           console.log('logMsg 0000  444 ', logMsg);
//           metricData.push({1:1});//putMeetingStatusMetricData(logMsg));
//           console.log('logMsg 0000 5555 ', logMsg);
//         } catch (ex) {
//           console.error('logMsg 0000 666 ', ex);
//         }
//       }
//
//       //  else if ((logMsg.MeetingJoin && logMsg.MeetingJoin !== null) || (logMsg.MeetingLeave && logMsg.MeetingLeave !== null) || (logMsg.alivePing && logMsg.alivePing !== null) || (logMsg.PongReceived && logMsg.PongReceived !== null)) {
//       //   try {
//       //     console.log('logMsg 444 ', logMsg);
//       //     metricData.push(await putMeetingStatusMetricData(logMsg));
//       //     console.log('logMsg 5555 ', logMsg);
//       //   } catch (ex) {
//       //     console.error('logMsg 666 ', ex);
//       //   }
//       // }
//
//       const namespace = 'AlivePing';
//       var params = {
//         MetricData: metricData,
//         Namespace: namespace
//       };
//       console.log('try block', metricData);
//       if (metricData.length > 0) {
//         console.log('metric Data0000 ' + metricData.length);
//         console.log(metricData);
//         //publishMetricToCloudWatch(params);
//       }
//
//
//
//     }
//     const timestamp = new Date(log.timestampMs).toISOString();
//     const message = `${timestamp} [${log.sequenceNumber}] [${log.logLevel}] [meeting: ${body.meetingId.toString()}] [attendee: ${body.attendeeId}]: ${log.message}`;
//     logEvents.push({
//       message: message,
//       timestamp: log.timestampMs
//     });
//   }
//   putLogEventsInput.logEvents = logEvents;
//
//   try {
//     console.log('putLogEventsInput ', putLogEventsInput)
//     await cloudWatchClient.putLogEvents(putLogEventsInput).promise();
//   } catch (error) {
//     const errorMessage = `Failed to put CloudWatch log events with error ${error} and params ${JSON.stringify(putLogEventsInput)}`;
//     if (error.code === 'InvalidSequenceTokenException' || error.code === 'DataAlreadyAcceptedException') {
//       console.warn(errorMessage);
//     } else {
//       console.error(errorMessage);
//     }
//   }
//   respond(response,200, 'application/json', JSON.stringify({}));
// }
//
// function isJsonString(str) {
//   try {
//     if (str === null) {
//       return false;
//     }
//     const json = JSON.parse(str);
//     return (typeof json === 'object');
//   } catch (e) {
//     return false;
//   }
// }
//
//
// function putMeetingStatusMetricData(logMsg) {
//   const instanceId = String(logMsg.instanceId);
//   const meetingId = String(logMsg.meetingId);
//   const attendeeId = String(logMsg.attendeeId);
//   let metric_name = '';
//   let metric_value = 0;
//   console.log('logMsg sssss', logMsg);
//   if (logMsg.MeetingJoin !== undefined) {
//     metric_name = 'MeetingJoin';
//     metric_value = logMsg[metric_name];
//   }
//   else if (logMsg.MeetingLeave !== undefined) {
//     metric_name = 'MeetingLeave';
//     metric_value = logMsg[metric_name];
//   }
//   else if (logMsg.alivePing !== undefined) {
//     metric_name = 'alivePing';
//     metric_value = logMsg[metric_name];
//   }
//   else if (logMsg.PongReceived !== undefined) {
//     metric_name = 'PongReceived';
//     metric_value = logMsg[metric_name];
//   }
//   else if (logMsg.StatusCode !== undefined) {
//     metric_name = 'StatusCode-' + logMsg['StatusCode'];
//     metric_value = 1;
//   }
//   else if (logMsg.MeetingStarted !== undefined) {
//     metric_name = 'MeetingStarted';
//     metric_value = logMsg[metric_name];
//   }
//   else if (logMsg.ReconnectingMeeting !== undefined) {
//     metric_name = 'ReconnectingMeeting';
//     metric_value = logMsg[metric_name];
//   }
//   else if (logMsg.ConnectingMeeting !== undefined) {
//     metric_name = 'ConnectingMeeting';
//     metric_value = logMsg[metric_name];
//   }
//
//   console.log(instanceId, `Emitting metric: ${metric_name} --> ${metric_value} : `);
//   delete logMsg.meetingId;
//   delete logMsg.attendeeId;
//   const data = new Date().toISOString() + ' ' + meetingId + '_' + attendeeId + ' ' + JSON.stringify(logMsg);
//   console.log('data_1 0000 ', data);
//
//   writeToFile(data, meetingId, instanceId);
//   console.log('data_1 11111', data);
//
//   return {
//     MetricName: metric_name,
//     Dimensions: [{
//       Name: 'Instance',
//       Value: instanceId
//     }],
//     Timestamp: new Date().toISOString(),
//     Value: metric_value
//   };
// }
//
//
// function putMetricData(logMsg, meetingId, attendeeId) {
//   const instanceId = logMsg.instanceId;
//   const loadTestStartTime = logMsg.loadTestStartTime;
//   console.log('instanceId... ' + instanceId);
//   console.log('loadTestStartTime... ' + loadTestStartTime);
//   console.log('loadMsg... ' + logMsg);
//   delete logMsg.instanceId;
//   delete logMsg.loadTestStartTime;
//
//   const dimensions = [
//     {
//       Name: 'MeetingId',
//       Value: meetingId
//     },
//     {
//       Name: 'AttendeeId',
//       Value: attendeeId
//     },
//     {
//       Name: 'Instance',
//       Value: instanceId
//     },
//     {
//       Name: 'LoadTestStartTime',
//       Value: loadTestStartTime.toLocaleString()
//     }
//   ];
//
//   //console.log(`Emitting metric: ${namespace} / meetingActive : ` + 1);
//   delete logMsg.availableSendBandwidth;
//   const data = new Date().toISOString() + ' ' + meetingId + '_' + attendeeId + ' ' + JSON.stringify(logMsg);
//   console.log('data_1 ', data);
//
//   writeToFile(data, meetingId, instanceId);
//   transferFileToS3('ClientMetric_' + meetingId + '_' + instanceId);
//   let metricData = [];
//   for (const [metric_name, metric_value] of Object.entries(logMsg)) {
//     console.log(`Emitting metric: ${metric_name} : ` + metric_value);
//     metricData.push({
//       MetricName: metric_name,
//       Dimensions: dimensions,
//       Timestamp: new Date().toISOString(),
//       Value: metric_value
//     });
//   }
//   return metricData;
//
// }
//
// async function publishMetricToCloudWatch(params) {
//   try {
//     var cloudWatch = new AWS.CloudWatch({
//       apiVersion: '2010-08-01'
//     });
//     console.log('params', params);
//     let res = await cloudWatch.putMetricData(params).promise();
//     if (res !== null) {
//       console.log('putMetricData successful ', res);
//     } else {
//       console.log('putMetricData failed ', res);
//     }
//   } catch (error) {
//     console.error(`Unable to emit metric: ${error}`)
//   }
// }
//
// async function ensureLogStream(cloudWatchClient, logStreamName, logGroupName) {
//   const logStreamsResult = await cloudWatchClient.describeLogStreams({
//     logGroupName: logGroupName,
//     logStreamNamePrefix: logStreamName,
//   }).promise();
//   const foundStream = logStreamsResult.logStreams.find(s => s.logStreamName === logStreamName);
//   if (foundStream) {
//     return foundStream.uploadSequenceToken;
//   }
//   await cloudWatchClient.createLogStream({
//     logGroupName: logGroupName,
//     logStreamName: logStreamName,
//   }).promise();
//   return null;
// }
//
//
// function returnResponse(statusCode, contentType, body) {
//   return {
//     statusCode: statusCode,
//     headers: {'Content-Type': contentType},
//     body: body,
//     isBase64Encoded: false
//   };
// }
//
// async function writeToFile (data, meetingId, instanceId) {
//   const filename = 'ClientMetric_' + meetingId + '_' + instanceId;
//   fs.appendFile(filename, data+'\n', function (err) {
//     if (err) throw err;
//   });
// }
//
// function transferFileToS3(fileToUpload) {
//   exec(`aws s3api put-object --bucket chimesdkmeetingsloadtest --key ClientMetric/`);
//   exec(`aws s3 cp ${fileToUpload} s3://chimesdkmeetingsloadtest/ClientMetric/ `);
// }
//
// */
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
//
// //
// //
// // function collectRequestData(request, callback) {
// //   // const FORM_URLENCODED = 'application/x-www-form-urlencoded';
// //   // if(request.headers['content-type'] === FORM_URLENCODED)
// //   {
// //     let body = '';
// //     request.on('data', chunk => {
// //       body += chunk.toString();
// //     });
// //     request.on('end', () => {
// //       callback(body);
// //     });
// //   }
// //   // else {
// //   //   callback(null);
// //   // }
// // }
//
//
//
//
//
//
//
//
// // Copyright 2019-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// // SPDX-License-Identifier: Apache-2.0
//
// const AWS = require('aws-sdk');

// const compression = require('compression');
// const fs = require('fs');
// const http = require('http');
// const url = require('url');
// const { v4: uuidv4 } = require('uuid');
// const {exec} = require('child_process');
// const lambda = new AWS.Lambda();
// AWS.config.region = 'us-east-1';
// const cloudWatch = new AWS.CloudWatch({
//   apiVersion: '2010-08-01'
// });
// const cloudWatchClient = new AWS.CloudWatchLogs({
//   apiVersion: '2014-03-28'
// });
// const cloudwatchlogs = new AWS.CloudWatchLogs({
//   apiVersion: '2014-03-28'
// });
// const s3 = new AWS.S3({
//   apiVersion: '2006-03-01'
// });
//
// // Store created meetings in a map so attendees can join by meeting title
// const meetingTable = {};
//
// // Use local host for application server
// const host = '127.0.0.1:8080';
//
// // Load the contents of the web application to be used as the index page
// const indexPage = fs.readFileSync(`dist/${process.env.npm_config_app || 'meetingV2'}.html`);
//
// // Create ans AWS SDK Chime object. Region 'us-east-1' is currently required.
// // Use the MediaRegion property below in CreateMeeting to select the region
// // the meeting is hosted in.
// const chime = new AWS.Chime({ region: 'us-east-1' });
//
// // Set the AWS SDK Chime endpoint. The global endpoint is https://service.chime.aws.amazon.com.
// // chime.endpoint = new AWS.Endpoint(process.env.ENDPOINT || 'https://service.chime.aws.amazon.com');
// chime.endpoint = new AWS.Endpoint( 'https://tapioca.us-east-1.amazonaws.com');
//
// // Start an HTTP server to serve the index page and handle meeting actions
// http.createServer({}, async (request, response) => {
//   log(`${request.method} ${request.url} BEGIN`);
//   try {
//
//     // collectRequestData(request, result => {
//     //   console.log(result);
//     //   response.end('Parsed data belonging to, ', result);
//     // });
//     // Enable HTTP compression
//     compression({})(request, response, () => {});
//     const requestUrl = url.parse(request.url, true);
//    // let requestBody = [];
//
//     let rBody = '';
//     const logGroupName = 'ChimeBrowserLogs1';
//     const requestBody = await new Promise((resolve, reject) => {
//       let requestBody = '';
//       request.on('error', (err) => {
//         console.error(err);
//       }).on('data', (chunk) => {
//         rBody = chunk.toString();
//
//       }).on('end', () => {
//         requestBody += rBody;
//         console.log('requestBody 1111 ', requestBody);
//         resolve(requestBody);
//         // At this point, we have the headers, method, url and body, and can now
//         // do whatever we need to in order to respond to this request.
//       });
//     });
//     console.log('requestBody 22222 ', requestBody);
//
//     if (requestUrl.pathname === '/create_log_stream') {
//       /*console.log('22222 2223333 JDYDH  HSD ASH LD jfurjfi  sadfhdsf jhasdf ', requestBody);
//       console.log('22222 2223333 JDYDH  HSD ASH LD jfurjfi  sadfhdsf jhasdf ', requestUrl.query.attendeeId);
//
//       const body = JSON.parse(requestBody);
//       if (!body.meetingId || !body.attendeeId) {
//         throw new Error('Need parameters: meetingId, attendeeId');
//       }
//
//       //const cloudwatchlogs = new AWS.CloudWatchLogs({apiVersion: '2014-03-28'});
//       // var params = {
//       //   logGroupName: logGroupName
//       // };
//       // await cloudwatchlogs.createLogGroup(params).promise();
//       const logStreamName = `ChimeSDKMeeting_${body.meetingId.toString()}_${body.attendeeId.toString()}`;
//       console.log(logStreamName);
//       await cloudwatchlogs.createLogStream({
//         logGroupName: logGroupName,
//         logStreamName: logStreamName,
//       }).promise();
//       */
//       //respond(response, 200, 'application/json', JSON.stringify({}));
//
//     } else if (requestUrl.pathname === '/logs') {
//       await logsEndpoint(logGroupName, requestBody, response);
//
//
//     }
//
//     if (request.method === 'GET' && requestUrl.pathname === '/') {
//       // Return the contents of the index page
//       respond(response, 200, 'text/html', indexPage);
//     } else if (process.env.DEBUG && request.method === 'POST' && requestUrl.pathname === '/join') {
//       // For internal debugging - ignore this.
//       respond(response, 201, 'application/json', JSON.stringify(require('./debug.js').debug(requestUrl.query), null, 2));
//     } else if (requestUrl.pathname === '/get_load_test_status') {
//       console.log('asjdfhlkasdfh awdf ah sdflkjasdfh ');
//       const s3 = new AWS.S3({apiVersion: '2006-03-01'});
//       var getParams = {
//         Bucket: 'chimesdkmeetingsloadtest',
//         Key: 'src/configs/LoadTestStatus.json'
//       };
//       console.log('11111');
//       try {
//         console.log('2222222');
//
//         const data = await s3.getObject(getParams).promise();
//         console.log('333333');
//
//         const loadTestStatus = data.Body.toString('utf-8');
//         console.log('444444');
//
//         respond(response, 200, 'application/json', loadTestStatus);
//       } catch(err) {
//         console.error('Could not read status: ', err);
//         respond(response, 400, 'application/json', JSON.stringify({}));
//       }
//     } else if (request.method === 'POST' && requestUrl.pathname === '/join') {
//       if (!requestUrl.query.title || !requestUrl.query.name || !requestUrl.query.region) {
//         throw new Error('Need parameters: title, name, region');
//       }
//
//       // Look up the meeting by its title. If it does not exist, create the meeting.
//       if (!meetingTable[requestUrl.query.title]) {
//         meetingTable[requestUrl.query.title] = await chime.createMeeting({
//           // Use a UUID for the client request token to ensure that any request retries
//           // do not create multiple meetings.
//           ClientRequestToken: uuidv4(),
//           // Specify the media region (where the meeting is hosted).
//           // In this case, we use the region selected by the user.
//           MediaRegion: requestUrl.query.region,
//           // Any meeting ID you wish to associate with the meeting.
//           // For simplicity here, we use the meeting title.
//           ExternalMeetingId: requestUrl.query.title.substring(0, 64),
//         }).promise();
//       }
//
//       // Fetch the meeting info
//       const meeting = meetingTable[requestUrl.query.title];
//
//       // Create new attendee for the meeting
//       const attendee = await chime.createAttendee({
//         // The meeting ID of the created meeting to add the attendee to
//         MeetingId: meeting.Meeting.MeetingId,
//
//         // Any user ID you wish to associate with the attendeee.
//         // For simplicity here, we use a random id for uniqueness
//         // combined with the name the user provided, which can later
//         // be used to help build the roster.
//         ExternalUserId: `${uuidv4().substring(0, 8)}#${requestUrl.query.name}`.substring(0, 64),
//       }).promise()
//
//       // Return the meeting and attendee responses. The client will use these
//       // to join the meeting.
//       respond(response, 201, 'application/json', JSON.stringify({
//         JoinInfo: {
//           Meeting: meeting,
//           Attendee: attendee,
//         },
//       }, null, 2));
//     } else if (request.method === 'POST' && requestUrl.pathname === '/end') {
//       // End the meeting. All attendee connections will hang up.
//       await chime.deleteMeeting({
//         MeetingId: meetingTable[requestUrl.query.title].Meeting.MeetingId,
//       }).promise();
//       const cmd = `aws cloudwatch put-metric-data --metric-name 'DeleteMeeting' --dimensions Instance=\`curl http://169.254.169.254/latest/meta-data/instance-id\`  --namespace 'AlivePing' --value 1`;
//       exec(cmd);
//       respond(response, 200, 'application/json', JSON.stringify({}));
//     } else {
//       //respond(response, 404, 'text/html', '404 Not Found');
//     }
//   } catch (err) {
//     console.log(err);
//   }
//   log(`${request.method} ${request.url} END`);
// }).listen(host.split(':')[1], host.split(':')[0], () => {
//   log(`server running at http://${host}/`);
// });
//
// function log(message) {
//   console.log(`${new Date().toISOString()} ${message}`);
// };
//
// function respond(response, statusCode, contentType, body) {
//   response.statusCode = statusCode;
//   response.setHeader('Content-Type', contentType);
//   response.end(body);
//   if (contentType === 'application/json') {
//     log(body);
//   }
// }
//
//
//
//
// async function logsEndpoint(logGroupName, requestBody, response) {
//   console.log('requestBody');
//   console.log(requestBody);
//   const body = JSON.parse(requestBody);
//   if (!body.logs || !body.meetingId || !body.attendeeId || !body.appName) {
//     respond(response,400, 'application/json', JSON.stringify({error: 'Need properties: logs, meetingId, attendeeId, appName'}));
//   } else if (!body.logs.length) {
//     respond(response,200, 'application/json', JSON.stringify({}));
//   }
//
//   const logStreamName = `ChimeSDKMeeting_${body.meetingId.toString()}_${body.attendeeId.toString()}`;
//   const putLogEventsInput = {
//     logGroupName: logGroupName,
//     logStreamName: logStreamName
//   };
//   const uploadSequence = await ensureLogStream(logStreamName, logGroupName);
//   if (uploadSequence) {
//     putLogEventsInput.sequenceToken = uploadSequence;
//   }
//   const logEvents = [];
//
//   for (let i = 0; i < body.logs.length; i++) {
//     const log = body.logs[i];
//     console.log(' log : ', typeof log, log);
//     console.log(' logMessage : ', typeof log.message, log.message);
//     console.log(' logMessage True/False: ', typeof log.message === 'object');
//     console.log('dddd ', log.message);
//     let isJSONString = false;
//     let jsonLogMessage = null;
//     try {
//       if (log.message === null || log.message === '') {
//         isJSONString = false;
//       }
//       jsonLogMessage = JSON.parse(log.message);
//       isJSONString = (typeof jsonLogMessage === 'object');
//     } catch (e) {
//       isJSONString = false;
//     }
//     if (isJSONString && jsonLogMessage !== null) {
//       console.log(typeof jsonLogMessage, ' jsonLogMessage 000 ', jsonLogMessage);
//       console.log(jsonLogMessage.audioPacketsReceived, typeof jsonLogMessage.audioPacketsReceived);
//       console.log(jsonLogMessage.audioPacketsReceived !== null);
//       let metricData = [];
//       if ((jsonLogMessage.audioPacketsReceived && jsonLogMessage.audioPacketsReceived !== null)) {
//
//         try {
//           console.log('jsonLogMessage 1111 ', jsonLogMessage);
//           const metricDataLocal = await putMetricData(jsonLogMessage, body.meetingId, body.attendeeId);
//           console.log('jsonLogMessage 11112222 ', metricDataLocal);
//           for (let data = 0; data < metricDataLocal.length; data += 1) {
//             metricData.push(metricDataLocal[data]);
//           }
//           console.log('jsonLogMessage 2222 ', jsonLogMessage);
//
//         } catch (ex) {
//           console.error('jsonLogMessage 3333 ', ex);
//         }
//       } else {
//         try {
//           console.log('jsonLogMessage 0000  444 ', jsonLogMessage);
//           metricData.push(await putMeetingStatusMetricData(jsonLogMessage));
//           console.log('jsonLogMessage 0000 5555 ', jsonLogMessage);
//         } catch (ex) {
//           console.error('jsonLogMessage 0000 666 ', ex);
//         }
//       }
//
//       //  else if ((jsonLogMessage.MeetingJoin && jsonLogMessage.MeetingJoin !== null) || (jsonLogMessage.MeetingLeave && jsonLogMessage.MeetingLeave !== null) || (jsonLogMessage.alivePing && jsonLogMessage.alivePing !== null) || (jsonLogMessage.PongReceived && jsonLogMessage.PongReceived !== null)) {
//       //   try {
//       //     console.log('jsonLogMessage 444 ', jsonLogMessage);
//       //     metricData.push(await putMeetingStatusMetricData(jsonLogMessage));
//       //     console.log('jsonLogMessage 5555 ', jsonLogMessage);
//       //   } catch (ex) {
//       //     console.error('jsonLogMessage 666 ', ex);
//       //   }
//       // }
//
//       const namespace = 'AlivePing';
//       var params = {
//         MetricData: metricData,
//         Namespace: namespace
//       };
//       console.log('try block', metricData);
//       if (metricData.length > 0) {
//         console.log('metric Data0000 ' + metricData.length);
//         console.log(metricData);
//         await publishMetricToCloudWatch(params);
//       }
//
//
//       const timestamp = new Date(log.timestampMs).toISOString();
//       const message = `${timestamp} [${log.sequenceNumber}] [${log.logLevel}] [meeting: ${body.meetingId.toString()}] [attendee: ${body.attendeeId}]: ${log.message}`;
//       logEvents.push({
//         message: message,
//         timestamp: log.timestampMs
//       });
//     }
//   }
//   putLogEventsInput.logEvents = logEvents;
//
//   try {
//
//     await cloudWatchClient.putLogEvents(putLogEventsInput).promise();
//   } catch (error) {
//     const errorMessage = `Failed to put CloudWatch log events with error ${error} and params ${JSON.stringify(putLogEventsInput)}`;
//     if (error.code === 'InvalidSequenceTokenException' || error.code === 'DataAlreadyAcceptedException') {
//       console.warn(errorMessage);
//     } else {
//       console.error(errorMessage);
//     }
//   }
//   respond(response,200, 'application/json', JSON.stringify({}));
// }
//
// function isJsonString(str) {
//   try {
//     if (str === null) {
//       return false;
//     }
//     const json = JSON.parse(str);
//     return (typeof json === 'object');
//   } catch (e) {
//     return false;
//   }
// }
//
//
// async function putMeetingStatusMetricData(messageJson) {
//   const instanceId = String(messageJson.instanceId);
//   let metricName = '';
//   let metricValue = 0;
//   console.log('messageJson sssss', messageJson);
//   if (messageJson.MeetingJoin !== undefined) {
//     metricName = 'MeetingJoin';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.MeetingLeave !== undefined) {
//     metricName = 'MeetingLeave';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.alivePing !== undefined) {
//     metricName = 'alivePing';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.PongReceived !== undefined) {
//     metricName = 'PongReceived';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.StatusCode !== undefined) {
//     metricName = 'StatusCode-' + messageJson['StatusCode'];
//     metricValue = 1;
//   } else if (messageJson.MeetingStarted !== undefined) {
//     metricName = 'MeetingStarted';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.ReconnectingMeeting !== undefined) {
//     metricName = 'ReconnectingMeeting';
//     metricValue = messageJson[metricName];
//   } else if (messageJson.ConnectingMeeting !== undefined) {
//     metricName = 'ConnectingMeeting';
//     metricValue = messageJson[metricName];
//   }
//
//   console.log(instanceId, `Emitting metric: ${metricName} --> ${metricValue} : `);
//   return {
//     MetricName: metricName,
//     Dimensions: [{
//       Name: 'Instance',
//       Value: instanceId
//     }],
//     Timestamp: new Date().toISOString(),
//     Value: metricValue
//   };
// }
//
//
// async function putMetricData(messageJson, meetingId, attendeeId) {
//   const instanceId = messageJson.instanceId;
//   const loadTestStartTime = messageJson.loadTestStartTime;
//   console.log('instanceId... ' + instanceId);
//   console.log('loadTestStartTime... ' + loadTestStartTime);
//   console.log('loadMsg... ' + messageJson);
//   delete messageJson.instanceId;
//   delete messageJson.loadTestStartTime;
//
//   const dimensions = [
//     {
//       Name: 'MeetingId',
//       Value: meetingId
//     },
//     {
//       Name: 'AttendeeId',
//       Value: attendeeId
//     },
//     {
//       Name: 'Instance',
//       Value: instanceId
//     },
//     {
//       Name: 'LoadTestStartTime',
//       Value: loadTestStartTime.toLocaleString()
//     }
//   ];
//
//   //console.log(`Emitting metric: ${namespace} / meetingActive : ` + 1);
//   delete messageJson.availableSendBandwidth;
//   const metricData = [];
//   for (const [metricName, metricValue] of Object.entries(messageJson)) {
//     console.log(`Emitting metric: ${metricName} : ` + metricValue);
//     metricData.push({
//       MetricName: metricName,
//       Dimensions: dimensions,
//       Timestamp: new Date().toISOString(),
//       Value: metricValue
//     });
//   }
//   return metricData;
//
// }
//
// async function publishMetricToCloudWatch(params) {
//   try {
//     console.log('params', params);
//     let res = await cloudWatch.putMetricData(params).promise();
//     if (res !== null) {
//       console.log('putMetricData successful ', res);
//     } else {
//       console.log('putMetricData failed ', res);
//     }
//   } catch (error) {
//     console.error(`Unable to emit metric: ${error}`)
//   }
// }
//
// async function ensureLogStream(logStreamName, logGroupName) {
//   const logStreamsResult = await cloudWatchClient.describeLogStreams({
//     logGroupName: logGroupName,
//     logStreamNamePrefix: logStreamName,
//   }).promise();
//   const foundStream = logStreamsResult.logStreams.find(s => s.logStreamName === logStreamName);
//   if (foundStream) {
//     return foundStream.uploadSequenceToken;
//   }
//   await cloudWatchClient.createLogStream({
//     logGroupName: logGroupName,
//     logStreamName: logStreamName,
//   }).promise();
//   return null;
// }
//
//
// function returnResponse(statusCode, contentType, body) {
//   return {
//     statusCode: statusCode,
//     headers: {'Content-Type': contentType},
//     body: body,
//     isBase64Encoded: false
//   };
// }
// //
// //
// // function collectRequestData(request, callback) {
// //   // const FORM_URLENCODED = 'application/x-www-form-urlencoded';
// //   // if(request.headers['content-type'] === FORM_URLENCODED)
// //   {
// //     let body = '';
// //     request.on('data', chunk => {
// //       body += chunk.toString();
// //     });
// //     request.on('end', () => {
// //       callback(body);
// //     });
// //   }
// //   // else {
// //   //   callback(null);
// //   // }
// // }
