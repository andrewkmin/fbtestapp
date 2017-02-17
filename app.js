/* this is another take!
* Copyright 2016-present, Facebook, Inc.
* All rights reserved.
*
* This source code is licensed under the license found in the
* LICENSE file in the root directory of this source tree.
*
*/

/* jshint node: true, devel: true */
'use strict';
const
bodyParser = require('body-parser'),
config = require('config'),
crypto = require('crypto'),
express = require('express'),
https = require('https'),
request = require('request'),
oneLinerJoke = require('one-liner-joke'),
changeCase = require('change-case'),
mongoose = require('mongoose'),

words = ['onboard'],
autocorrect = require('autocorrect')({words: words})

var Client = require('coinbase').Client;
var client = new Client({
  'apiKey': 'API KEY',
  'apiSecret': 'API SECRET'
});

var google_speech = require('google-speech');
var User = require('./models/user').User;
var Nuance = require('nuance');
var nuance = new Nuance('appID', 'appKey');

mongoose.connection.on('connected', function() {
  console.log('Success: connected to MongoDb!');
});
mongoose.connection.on('error', function() {
  console.log('Error connecting to MongoDb. Check MONGODB_URI in config.js');
  process.exit(1);
});
mongoose.connect(process.env.MONGODB_URI);

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

/*
* Be sure to setup your config values before running this code. You can
* set them using environment variables or modifying the config file in /config.
*
*/

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
process.env.MESSENGER_APP_SECRET :
config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
(process.env.MESSENGER_VALIDATION_TOKEN) :
config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
(process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = (process.env.SERVER_URL) ?
(process.env.SERVER_URL) :
config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
* Use your own validation token. Check that the token used in the Webhook
* setup is the same token used here.
*
*/
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
  req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});

app.get('/postaudio', function(req, res){
  request.post('https://speech.googleapis.com/v1beta1/speech:syncrecognize',{
    json:{
      'config': {
        'encoding':'FLAC',
        'sampleRate': 16000,
        'languageCode': 'en-US'
      },
      'audio': {
        'uri':'https://cdn.fbsbx.com/v/t59.3654-21/15659141_10212710443139227_531252545021018112_n.mp4/audioclip-1487359152000-2396.mp4?oh=afd4180b0e8da076250c3925b17e1469&oe=58A8EAF3'
      }
    }
  },  function (error, response, body) {
    if (!error && response.statusCode == 200) {
      res.json(body) //
    } else res.json(error);
  })
})

/*
* All callbacks for Messenger are POST-ed. They will be sent to the same
* webhook. Be sure to subscribe your app to your page to receive callbacks
* for your page.
* https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
*
*/
app.post('/webhook', function (req, res) {
  var data = req.body;
  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

app.post('/me/thread_settings?access_token=' + process.env.MESSENGER_PAGE_ACCESS_TOKEN)
/*
* This path is used for account linking. The account linking call-to-action
* (sendAccountLinking) is pointed to this URL.
*
*/
app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query.account_linking_token;
  var redirectURI = req.query.redirect_uri;

  // Authorization Code should be generated per user by the developer. This will
  // be passed to the Account Linking callback.
  var authCode = "1234567890";

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});
/*
* Verify that the callback came from Facebook. Using the App Secret from
* the App Dashboard, we can verify the signature that is sent with each
* callback in the x-hub-signature field, located in the header.
*
* https://developers.facebook.com/docs/graph-api/webhooks#setup
*
*/
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];
  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];
    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
    .update(buf)
    .digest('hex');
    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}
/*
* Authorization Event
*
* The value for 'optin.ref' is defined in the entry point. For the "Send to
* Messenger" plugin, it is the 'data-ref' field. Read more at
* https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
*
*/
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;
  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger'
  // plugin.
  var passThroughParam = event.optin.ref;
  console.log("Received authentication for user %d and page %d with pass " +
  "through param '%s' at %d", senderID, recipientID, passThroughParam,
  timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}
/*
* Message Event
*
* This event is called when a message is sent to your page. The 'message'
* object format can vary depending on the kind of message that was received.
* Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
*
* For this example, we're going to echo any text that we get. If we get some
* special keywords ('button', 'generic', 'receipt'), then we'll send back
* examples of those bubbles to illustrate the special message bubbles we've
* created. If we receive a message with an attachment (image, video, audio),
* then we'll simply confirm that we've received the attachment.
*
*/
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;
  // FIX THIS
  // var myUser = {};
  // // initial save of user information if he doesnt exist already
  // User.findOne({userId: senderID}, function(err, foundUser) {
  //   if(!foundUser) {
  //     var user = new User({
  //       userId: senderID,
  //       preferredExchange: [],
  //       preferredTime: ''
  //     }).save();
  //     myUser = user;
  //   } else {
  //     console.log('FOUND A USER; inside function');
  //     myUser = foundUser;
  //     console.log(myUser);
  //   }
  // })
  // console.log('outside!')
  // console.log(myUser);
  // var myCurrency = myUser.preferredExchange[0];
  // var myTime = myUser.preferredTime;
  console.log("Received message for user %d and page %d at %d with message:",
  senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));
  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;
  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;
  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
    messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
    messageId, quickReplyPayload);
    if(quickReplyPayload === 'bitstamp') {
      var arr = [];
      arr.push('bitstamp');
      User.findOneAndUpdate({userId: senderID}, {preferredExchange: arr}, function(err, foundUser) {
        console.log(foundUser);
      })
      return sendTextMessage(senderID, 'Saved.');
    } else if(quickReplyPayload === 'coinbase') {
      var arr = [];
      arr.push('coinbase');
      User.findOneAndUpdate({userId: senderID}, {preferredExchange: arr}, function(err, foundUser) {
        console.log(foundUser);
      })
      return sendTextMessage(senderID, 'Saved.');
      // else if(quickReplyPayload === 'otherExchange') {
      //   return sendTextMessage(senderID, "Hmmmm idk what to do then b");
      // ROUTING PURPOSES
    } else if(quickReplyPayload === 'exchange'){
      return exchangeReply(senderID);
    } else if(quickReplyPayload === 'alert'){
      return alertReply(senderID);
    } else if(quickReplyPayload === 'morning'){
      var preferredTime = 'morning';
      User.findOneAndUpdate({userId: senderID}, {preferredTime: preferredTime}, function(err, foundUser) {
        console.log(foundUser);
      })
      return sendTextMessage(senderID, 'Saved.');
    } else if(quickReplyPayload === 'noon'){
      var preferredTime = 'noon';
      User.findOneAndUpdate({userId: senderID}, {preferredTime: preferredTime}, function(err, foundUser) {
        console.log(foundUser);
      })
      return sendTextMessage(senderID, 'Saved.');
    } else if(quickReplyPayload === 'afternoon'){
      var preferredTime = 'afternoon';
      User.findOneAndUpdate({userId: senderID}, {preferredTime: preferredTime}, function(err, foundUser) {
        console.log(foundUser);
      })
      return sendTextMessage(senderID, 'Saved.');
      // }
      // // sendTextMessage(senderID, "Quick reply tapped");
      // return;
    } else if (messageText) {
      console.log('inside message text')
      // If we receive a text message, check to see if it matches any special
      // keywords and send back the corresponding example. Otherwise, just echo
      // the text we received.
      switch (changeCase.lowerCase(messageText)) {
        case 'ticker':
        request('https://www.bitstamp.net/api/v2/ticker/btcusd/', function(error, response, body) {
          if (!error && response.statusCode == 200) {
            var msg = JSON.parse(body);
            var newMsg = "High: " + msg.high + "\n" + "Low: " + msg.low + "\n" + "Open: " + msg.open + "\n" + "source: bitstamp"
            sendTextMessage(senderID, newMsg);
          }
        })
        break;

        case 'menu':
        var msg = "These are all your options:";
        sendTextMessage(senderID, msg);
        // send image too
        break;

        case 'audio':
        sendAudioMessage(senderID);
        break;

        case 'add menu':
        addPersistentMenu();
        break;

        case 'haha':
        var getRandomJoke = oneLinerJoke.getRandomJoke();
        sendTextMessage(senderID, getRandomJoke.body);
        break;

        case 'preferences':
        // sendTextMessage(senderID, "What is your preferred exchange?");
        console.log('here in preferences')
        preferencesReply(senderID);
        break;

        case 'don dyu':
        sendGifMessage(senderID);
        break;

        case 'onboard': // deprecated because of "getting started" button
        var msg = 'Thanks for checking out Botty, your personal crypto-plug. We have a plethora of features in store for you. \n \nBriefing: a real-time summary of data, courtesy of Coinbase. \nButtons: click to view BLAH BLAH'
        sendTextMessage(senderID, msg);
        break;

        case 'buy price':
        client.getBuyPrice({'currencyPair': 'BTC-USD'},function(err, price) {
          sendTextMessage(senderID, 'Current bitcoin buyingprice in ' + 'usd' + ': ' +  price.data.amount)
        });
        break;

        case 'price':
        client.getSpotPrice({'currency': 'usd'},function(err, price) {
          sendTextMessage(senderID, 'Current bitcoin price in' + 'usd' + ': ' +  price.data.amount)
        });
        break;

        case 'sell price':
        client.getSellPrice({'currencyPair': 'BTC-USD'},function(err, price) {
          sendTextMessage(senderID, 'Current bitcoin sellingprice in ' + 'usd' + ': ' +  price.data.amount)
        });
        break;

        case 'bitcoin':
        sendBitcoin(senderID);
        break;

        case 'briefing':
        client.getSpotPrice({'currency': 'USD'}, function(err, price) {
          var spot = price.data.amount;
          client.getSellPrice({'currencyPair': 'BTC-USD'}, function(err, price) {
            var sell = price.data.amount;
            client.getBuyPrice({'currencyPair': 'BTC-USD'}, function(err, price) {
              var buy = price.data.amount;
              client.getTime(function(err, time) {
                var time = time.data.iso;
                var msg = 'Current pricing information as of ' + time + ':' + '\n' +
                'Sell: ' + sell + '\n' + 'Buy: ' + buy + '\n' + 'Spot: ' + spot;
                sendTextMessage(senderID, msg);
              })
            })
          })
        });
        break;
        // case messageText:
        //     var msg = "Did you mean... " + autocorrect(messageText) +
        //     sendCorrectMsg(senderID, msg, messageText);
        //     break;
        default:
        sendTextMessage(senderID, "Sorry, I could not recognize the command " + "'" + messageText + "'. Please try again, or type 'menu' to review your options.");
      }
    } else if (messageAttachments) {
      console.log('YOOOOOOO BRO')
      console.log(messageAttachments);
      sendTextMessage(senderID, "Message with attachment received");
    }
  }
}
////////////////////////// ADDING MENUS
function addPersistentMenu(){
  request({
    url: 'https://graph.facebook.com/v2.6/me/thread_settings',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json:{
      setting_type : "call_to_actions",
      thread_state : "existing_thread",
      call_to_actions:[
        {
          type:"postback",
          title:"Menu",
          payload:"menu"
        },
        {
          type:"postback",
          title:"Quick Summary",
          payload:"quick"
        }
      ]
    }

  }, function(error, response, body) {
    console.log(response)
    if (error) {
      console.log('Error sending messages: ', error)
    } else if (response.body.error) {
      console.log('Error: ', response.body.error)
    }
  })
}
/*
* Delivery Confirmation Event
*
* This event is sent to confirm the delivery of a message. Read more about
* these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
*
*/
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s",
      messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
* Postback Event
*
* This event is called when a postback is tapped on a Structured Message.
* https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
*
*/
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;
  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;
  if (payload === "Buy_Price"){
    client.getBuyPrice({'currencyPair': 'BTC-USD'}, function(err, price) {
      return sendTextMessage(senderID, 'Current bitcoin buying price in ' + 'USD' + ': ' +  price.data.amount)
    });
  } else if(payload === 'gettingStarted') {
    // COPY CASE MENU
    return sendTextMessage(senderID, "Hello");
  } else if (payload === "Sell_Price"){
    client.getSellPrice({'currencyPair': 'BTC-USD'}, function(err, price) {
      return sendTextMessage(senderID, 'Current bitcoin selling price in ' + 'USD' + ': ' +  price.data.amount)
    });
  } else if (payload === "Price"){
    client.getSpotPrice({'currency': 'usd'}, function(err, price) {
      return sendTextMessage(senderID, 'Current bitcoin price in ' + 'USD' + ': ' +  price.data.amount)
    });
  } else if (payload === "menu"){
    var msg = "You have the following options: "
    return sendTextMessage(senderID, msg)
  } else if (payload === "quick"){
    client.getSpotPrice({'currency': 'USD'}, function(err, price) {
      var spot = price.data.amount;
      client.getSellPrice({'currencyPair': 'BTC-USD'}, function(err, price) {
        var sell = price.data.amount;
        client.getBuyPrice({'currencyPair': 'BTC-USD'}, function(err, price) {
          var buy = price.data.amount;
          client.getTime(function(err, time) {
            var time = time.data.iso;
            var msg = 'Current pricing information as of ' + time + ':' + '\n' +
            'Sell: ' + sell + '\n' + 'Buy: ' + buy + '\n' + 'Spot: ' + spot;
            return sendTextMessage(senderID, msg);
          })
        })
      })
    });
  }
  console.log("Received postback for user %d and page %d with payload '%s' " +
  "at %d", senderID, recipientID, payload, timeOfPostback);
}
  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful
  // sendTextMessage(senderID, "Postback called");

/*
* Message Read Event
*
* This event is called when a previously-sent message has been read.
* https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
*
*/
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
  "number %d", watermark, sequenceNumber);
}
/*
* Account Link Event
*
* This event is called when the Link Account or UnLink Account action has been
* tapped.
* https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
*
*/
function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
  "and auth code %s ", senderID, status, authCode);
}

/*
* Send an image using the Send API.
*
*/
// THIS IS TO CREATE BITCOIN - BUTTONS
function sendBitcoin(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Bitcoin Options",
          buttons:[{
            type: "postback",
            title: "Buy Price",
            payload: "Buy_Price"
          }, {
            type: "postback",
            title: "Sell Price",
            payload: "Sell_Price"
          }, {
            type: "postback",
            title: "Spot Price",
            payload: "Price"
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
}
function sendImageMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: "https://bitcoincharts.com/charts/chart.png?width=940&m=bitstampUSD&SubmitButton=Draw&r=60&i=&c=0&s=&e=&Prev=&Next=&t=S&b=&a1=&m1=10&a2=&m2=25&x=0&i1=&i2=&i3=&i4=&v=1&cv=0&ps=0&l=0&p=0&"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
* Send a Gif using the Send API.
*
*/



function sendGifMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: "https://j.gifs.com/lOm4W1.gif"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
* Send audio using the Send API.
*
*/
function sendAudioMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "audio",
        payload: {
          url: "http://www.fromtexttospeech.com/output/0714078001487351330/21101657.mp3"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
* Send a video using the Send API.
*
*/
function sendVideoMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "video",
        payload: {
          url: SERVER_URL + "/assets/allofus480.mov"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
* Send a file using the Send API.
*
*/
function sendFileMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "file",
        payload: {
          url: SERVER_URL + "/assets/test.txt"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
* Send a text message using the Send API.
* OK THIS IS IMPORTANT!
*/
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

/*
* Send a button message using the Send API.
*
*/
function sendButtonMessage(recipientId) {

  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "http://bitcointicker.co/coinbase/",
            title: "Go to live ticker"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPER_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
* Send a Structured Message (Generic Message type) using the Send API.
*
*/
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",
            image_url: SERVER_URL + "/assets/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",
            image_url: SERVER_URL + "/assets/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };
  callSendAPI(messageData);
}

/*
* Send a receipt message using the Send API.
*
*/
function sendReceiptMessage(recipientId) {
  // Generate a random receipt ID as the API requires a unique ID
  var receiptId = "order" + Math.floor(Math.random()*1000);

  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment: {
        type: "template",
        payload: {
          template_type: "receipt",
          recipient_name: "Peter Chang",
          order_number: receiptId,
          currency: "USD",
          payment_method: "Visa 1234",
          timestamp: "1428444852",
          elements: [{
            title: "Oculus Rift",
            subtitle: "Includes: headset, sensor, remote",
            quantity: 1,
            price: 599.00,
            currency: "USD",
            image_url: SERVER_URL + "/assets/riftsq.png"
          }, {
            title: "Samsung Gear VR",
            subtitle: "Frost White",
            quantity: 1,
            price: 99.99,
            currency: "USD",
            image_url: SERVER_URL + "/assets/gearvrsq.png"
          }],
          address: {
            street_1: "1 Hacker Way",
            street_2: "",
            city: "Menlo Park",
            postal_code: "94025",
            state: "CA",
            country: "US"
          },
          summary: {
            subtotal: 698.99,
            shipping_cost: 20.00,
            total_tax: 57.67,
            total_cost: 626.66
          },
          adjustments: [{
            name: "New Customer Discount",
            amount: -50
          }, {
            name: "$100 Off Coupon",
            amount: -100
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
* Send a message with Quick Reply buttons.
*
*/
function sendQuickReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What's your favorite movie genre?",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Action",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
        },
        {
          "content_type":"text",
          "title":"Comedy",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
        },
        {
          "content_type":"text",
          "title":"Drama",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
        }
      ]
    }
  };
  callSendAPI(messageData);
}

//// CUSTOM QUICK REPLY
function preferencesReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What would you like to configure?",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Exchange",
          "payload":"exchange"
        },
        {
          "content_type":"text",
          "title":"Alert Frequency",
          "payload":"alert"
        },
        {
          "content_type":"text",
          "title":"Other",
          "payload":"otherPreferences"
        }
      ]
    }
  };
  callSendAPI(messageData);
}

function exchangeReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What is your preferred exchange?",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Bitstamp",
          "payload":"bitstamp"
        },
        {
          "content_type":"text",
          "title":"Coinbase",
          "payload":"coinbase"
        },
        {
          "content_type":"text",
          "title":"Other",
          "payload":"otherExchange"
        }
      ]
    }
  };
  callSendAPI(messageData);
}

function alertReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "When would you like to be notified during the day? (EST)",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Morning",
          "payload":"morning"
        },
        {
          "content_type":"text",
          "title":"Noon",
          "payload":"coinbase"
        },
        {
          "content_type":"text",
          "title":"Afternoon",
          "payload":"afternoon"
        }
      ]
    }
  };
  callSendAPI(messageData);
}

/*
* Send a read receipt to indicate the message has been read
*
*/
function sendReadReceipt(recipientId) {
  console.log("Sending a read receipt to mark message as seen");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "mark_seen"
  };

  callSendAPI(messageData);
}

/*
* Turn typing indicator on
*
*/
function sendTypingOn(recipientId) {
  console.log("Turning typing indicator on");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };

  callSendAPI(messageData);
}

/*
* Turn typing indicator off
*
*/
function sendTypingOff(recipientId) {
  console.log("Turning typing indicator off");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };

  callSendAPI(messageData);
}

/*
* Send a message with the account linking call-to-action
*
*/
function sendAccountLinking(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome. Link your account.",
          buttons:[{
            type: "account_link",
            url: SERVER_URL + "/authorize"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
* Call the Send API. The message data goes in the body. If successful, we'll
* get the message id in a response
*
*/
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
        messageId, recipientId);
      } else {
        console.log("Successfully called Send API for recipient %s",
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}


function setGreetingText() {
  var greetingData = {
    "setting_type":"call_to_actions",
    "thread_state":"new_thread",
    "greeting": {
      text: "Hi {{user_first_name}}! \n Welcome to our onboarding process. To begin, please hit 'Get Started'." // this part is overwritten by fb
    },
    "call_to_actions":[
      {
        "payload":"gettingStarted"
      }]
    }
    createGreetingApi(greetingData);
  }

  function createGreetingApi(data) {
    request({
      uri: 'https://graph.facebook.com/v2.6/me/thread_settings',
      qs: { access_token: PAGE_ACCESS_TOKEN },
      method: 'POST',
      json: data

    }, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        console.log("Greeting set successfully!");
      } else {
        console.error("Failed calling Thread Reference API", response.statusCode, response.statusMessage, body.error);
      }
    });
  }

  // function setGreetingText() {
  //   var greetingData = {
  //     setting_type: "greeting",
  //     greeting:{
  //       text:"Hi {{user_first_name}}! \n Welcome to our onboarding process. To begin, please type 'onboard'."
  //     }
  //   };
  //   createGreetingApi(greetingData);
  // // }

  // Start server
  // Webhooks must be available via SSL with a certificate signed by a valid
  // certificate authority.
  app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
    setGreetingText() ;
  });

  module.exports = app;
