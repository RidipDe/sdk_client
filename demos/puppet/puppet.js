var fs = require('fs');
const puppeteer = require('puppeteer');

const MIN_ACTIVE_TIME_MS = 20000;
const MAX_ACTIVE_TIME_MS = 25000;

function getRndDuration() {
  return Math.floor(Math.random() * (MAX_ACTIVE_TIME_MS - MIN_ACTIVE_TIME_MS + 1) ) + MIN_ACTIVE_TIME_MS;
}


run()
  .then(() => {
    console.log('Done');
  }).catch(error => {
    console.log(error);
  });

async function run() {

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--hostname localhost',
      '--no-sandbox', '--disable-setuid-sandbox'
    ],
    //executablePath:'/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome'
  });

  var page = new Array();
  const randomDuration = new Array();
  const meetingId = "Meeting "+Math.random();
  const noOfAttendee = 10;
  const startTimeMs = Date.now();

  for(var i = 0; i<noOfAttendee; i++) {
    page[i] = await browser.newPage();
    await page[i].goto('localhost:8080/?m='+meetingId);
   // await page[i].goto('https://g4eowuwvpf.execute-api.us-east-1.amazonaws.com/Prod/v2/?m=dsdftyui546789');

    await page[i].evaluate((i) => {
      // document.getElementById('inputMeeting').value = meetingId;
      document.getElementById('inputName').value = i+ "] Attendee " + Math.random();
      document.getElementById('authenticate').click();
      //document.getElementById('joinButton').click();
      //setTimeout(function(){ window.location.replace("http://www.w3schools.com"); }, 3000);
    }, i);
    randomDuration[i] = getRndDuration();
    console.log(randomDuration[i]);
    //await page[i].evaluateOnNewDocument(fs.readFileSync('./helperFunctions.js', 'utf8'));
    //await page[i].addScriptTag({path: './helperFunctions.js', arguments: '10000'});
    await page[i].addScriptTag({content: 'setTimeout(function(){ document.getElementById(\'button-meeting-leave\').click(); }, ' + randomDuration[i] + ');'});

    await new Promise(resolve => setTimeout(resolve, 500));
    //await page[i].close();
  }
  const stopimeMs = Date.now();
  await new Promise(resolve => setTimeout(resolve, 3000));
  page[i-1].screenshot({path:meetingId+'.png'});

  const MAX_DURATION_FOR_ATTENDEE = Math.max(...randomDuration);
  const timeToWaitBeforeClosingTabs = MAX_DURATION_FOR_ATTENDEE
  console.log('Waiting for ' + timeToWaitBeforeClosingTabs + 'ms before closing the tabs');

  var noOfBrowsersClosed = 0;
  setTimeout(async() => {
    console.log('Close tabs initiated')
    //close all tabs after the max duration passes
    for (var tabNo = 0; tabNo < noOfAttendee; tabNo++) {
      try {
        if(!page[tabNo].isClosed())
          await page[tabNo].close();
      } catch (e) {
        console.log(e);
      } finally {
        //await browser.close();
      }
    }
  }, timeToWaitBeforeClosingTabs);

  await new Promise(resolve => setTimeout(resolve, timeToWaitBeforeClosingTabs+2000));
// console.log(await browser.pages().length);
//   if ((await browser.pages()).length === 1) {
  if(browser.isConnected()) {
    console.log('Close browser initiated')
    await browser.close();
  }
  // }

}




/*
const puppeteer = require('puppeteer');

run().then(() => console.log('Done')).catch(error => console.log(error));

async function run() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('localhost:8080');

  // Type "JavaScript" into the search bar
  await page.evaluate(async () => {
    document.getElementById('inputMeeting').value = "NewMeetingValue76545678";
    document.getElementById('inputName').value = "NewAttendee";
    document.getElementById('authenticate').click();
    await new Promise(resolve => setTimeout(resolve, 5000));

    document.getElementById('joinButton').click();


    //if transition to next page successfull

    //if failed

  });



  await new Promise(resolve => setTimeout(resolve, 5000));
  //await browser.close();
}
*/
//
// var fs = require('fs');
// const puppeteer = require('puppeteer');
//
// run().then(() => console.log('Done')).catch(error => console.log(error));
//
// async function run() {
//   const browser = await puppeteer.launch({ headless: false });
//   var page = new Array();
//   for(var i = 0; i<3; i++) {
//     page[i] = await browser.newPage();
//     await page[i].goto('https://google.com');
//
//     await page[i].evaluate(() => {
//       document.querySelector('.gLFyf').value = "Amazon";
//       document.querySelector('.gNO89b').click();
//       //setTimeout(function(){ window.location.replace("http://www.w3schools.com"); }, 3000);
//     });
//
//     await page[i].evaluateOnNewDocument(fs.readFileSync('./helperFunctions.js', 'utf8'));
//     //await page[i].addScriptTag({path: './helperFunctions.js', type:'utf8'});
//   }
//   await new Promise(resolve => setTimeout(resolve, 15000));
//   //await browser.close();
// }
//



// const puppeteer = require('puppeteer');
//
// run().then(() => console.log('Done')).catch(error => console.log(error));
//
// async function run() {
//   const browser = await puppeteer.launch({ headless: false });
//   const page = await browser.newPage();
//   await page.goto('https://google.com');
//
//   await page.evaluate(() => {
//     document.querySelector('.gLFyf').value = "Amazon"
//     document.querySelector('.gNO89b').click()
//   });
//
//   await new Promise(resolve => setTimeout(resolve, 5000));
//   await browser.close();
// }



/*

window.open("https://www.w3schools.com");
alert('Hi');


var opn = require('opn');// opens the url in the default browser
var tab1 = opn('http://sindresorhus.com');
var tab2 = opn('http://sindresorhus.com');

var newWindow = window.open('');

var url = 'http://google.com';
var start = (process.platform == 'darwin'? 'open': process.platform == 'win32'? 'start': 'xdg-open');
p = require('child_process').exec(start + ' ' + url);
setTimeout(1000);
p.document.querySelector('.gLFyf').value = "Hi"
p.document.querySelector('.gNO89b').click()

require('child_process').exec('kill -9 ' + p.pid);
p.pid
process.kill(p.pid)

*/