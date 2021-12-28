'use strict'

//*****************************************************************
// This is an example of API modbus driver for OrangeScada
// You can implement any other drives, using this code as template.
// For implement features of your own deiver, please go to customDriver module.
// Full description of all API functions you can get from cite
// https://www.orangescada.ru/docs/
//
// Version 1.0
// Author: OrangeScada company
//
//*****************************************************************



//*****************************************************************
// LOGGER PART
//*****************************************************************


const log = true;

// Log to console
function logger(message){
	if(log) console.log(message);
}


//*****************************************************************
// GET AND SET CONFIG PART
//*****************************************************************

const fs=require('fs'),
path = require('path'),
CustomDriver = require('./customDriver.js');

function getConfig(){
	const root = path.dirname(require.main.filename);
	const configJSON = fs.readFileSync(root+'/driverConfig.json', 'utf-8');
	let config = null;
	try{
		config = JSON.parse(configJSON);
	}catch(e){
		logger('Error JSON parse config file: '+e);
	}
	return config;
}

function setConfig(config) {
	let configJSON = JSON.stringify(config, null, 2);
	const root = path.dirname(require.main.filename);
	try{
		fs.writeFileSync(root+'/driverConfig.json', configJSON, {encoding: "utf8"});
	}catch(e){
		logger('Error write config file: '+e);
	}
}

//*****************************************************************
// Class ObjList for common operations on Nodes and Devices
//*****************************************************************

// Error text constants

const errServerConnectClosedTxt = 'Server connect closed';
const errServerConnectTxt 			= 'Server connect error';
const errCmdNotRecognizedTxt 		= 'Command not recognized';
const errIdNotFoundTxt 					= 'ID not found';
const errJSONParseTxt						= 'Error JSON parse:';
const errOptionsNotFoundTxt			= 'Options not found';
const errOptionsValidFailTxt		= 'Option value not valid';
const errNameAbsentTxt		  		= 'Name is absent in request';
const errIdAbsentTxt		  	  	= 'ID is absent in request';
const errWrongTypeTxt						= 'Wrong type';
const errOptionIdAbsentTxt			= 'Option ID absent';
const errOptionNameAbsentTxt		= 'Option name absent';
const errSelectValuesAbsentTxt	= 'Select values absent';
const errUidListTxt							= 'ID list read fail';

class ObjList {
	constructor(list, itemType, nodes){
		this.list = list;
		this.itemType = itemType;
		this.nodes = nodes;
	}
	// getListArray function transfer list object to array
	getListArray(){
		let res = [];
		for(let item in this.list){
			let itemNode={};
			itemNode.name = this.list[item].name;
			itemNode.uid = item;
			res.push(itemNode);
		};
		return res;
	}
	getNodes(dataObj){
		let answer = {cmd:dataObj.cmd, transID: dataObj.transID, nodes:this.getListArray()};
		return {answer:answer, error:""};
	}
	getDevices(dataObj){
		let devices = [];
		for(let item in this.list){
			if(!dataObj.uid || (this.list[item].nodeUid == dataObj.uid)){//в запросе uid, в доках nodeUid
				let deviceItem = {};
				deviceItem.name = this.list[item].name;
				deviceItem.uid = item;
				if(!dataObj.uid) deviceItem.nodeUid = this.list[item].nodeUid;
				devices.push(deviceItem);
			}
		}
		let answer = {cmd:dataObj.cmd, transID: dataObj.transID, devices: devices};
		return {answer:answer, error:""};
	}
	pingItem(dataObj){
		if(this.list[dataObj.uid]){
			let answer = {};
			if(this.itemType == 'nodes'){
				answer = {cmd:dataObj.cmd, transID: dataObj.transID};
			}else{
				answer = {cmd:dataObj.cmd, transID: dataObj.transID, active: this.list[dataObj.uid].active};
			}
			return {answer:answer, error:""};
		}else{
			return {error:errIdNotFoundTxt}
		}
	}
	// getNodeOptionsArray function transfer config.nodes.options object to array
	getOptionsToArray(uid){
		let res = [];
		let items = this.list[uid].options;
		if(items){
			for(let item in items){
				let itemOption={};
				let optionsScheme = config.optionsScheme && config.optionsScheme[this.itemType] && config.optionsScheme[this.itemType][item] ? config.optionsScheme[this.itemType][item] : null;
				if(optionsScheme){
					itemOption = Object.assign({},optionsScheme,items[item]);
					itemOption.uid = item;
					if(itemOption.type == 'select'){
						itemOption.selectValues = this.getSelectValuesToArray(itemOption.selectValues);
					}
					res.push(itemOption);
				}
			};
		};
		return res;
	}
	getSelectValuesToArray(selectValues){
		let res = [];
		for(let key in selectValues){
			let item = {};
			item.value = key;
			item.name = selectValues[key];
			res.push(item);
		}
		return res;
	}
	getDefaultOptionsToArray(){
		let res = [];
		let optionsScheme = config.optionsScheme && config.optionsScheme[this.itemType] ? config.optionsScheme[this.itemType] : null;
		if(optionsScheme){
			for(let item in optionsScheme){
				let itemOption = Object.assign({},optionsScheme[item]);
				itemOption.uid = item;
				if(itemOption.type == 'select'){
					itemOption.selectValues = this.getSelectValuesToArray(itemOption.selectValues);
				}
				res.push(itemOption);
			}
		}
		return res;
	}
	getItem(dataObj){
		if(!dataObj.uid){
			let answer = {cmd:dataObj.cmd, transID: dataObj.transID, options: this.getDefaultOptionsToArray()};
			return {answer:answer, error:""};
		}
		let item = this.list[dataObj.uid];
		if(item){
			let answer = {cmd:dataObj.cmd, transID: dataObj.transID, options: this.getOptionsToArray(dataObj.uid)};
			this.appendProps(item, answer);
			return {answer:answer, error:""};
		}else{
			return {error:errIdNotFoundTxt}
		}
	}
	isValueValid(optionItem, value){
		switch (optionItem.type) {
			case 'varchar':
				return true;
				break;
			case 'bool':
				return (value === false) || (value === true);
				break;
			case 'number':
				if(typeof value !== 'number') return false;
				return (optionItem.minValue === undefined || value >= optionItem.minValue) &&
							 (optionItem.maxValue === undefined || value <= optionItem.maxValue);
				break;
			case 'select':
				return optionItem.selectValues[value];
				break;
			default: return false;
		}
	}
	setItem(dataObj){
		if(this.list[dataObj.uid]){
			let warning = "";
			if(dataObj.options){
				for(let item of dataObj.options){
					let optionItemKey = Object.keys(item)[0];
					let schemeOptionItem = config.optionsScheme[this.itemType][optionItemKey];
					let optionItem = this.list[dataObj.uid].options[optionItemKey];
					if(optionItem && schemeOptionItem){
						if(this.isValueValid(schemeOptionItem,item[optionItemKey])){
							optionItem.currentValue = item[optionItemKey];
						}else{
							warning += errOptionsValidFailTxt + ",";
						}
					}else{
						warning += errOptionsNotFoundTxt + ",";
					}
				}
			}
			let propsWarning = this.appendProps(dataObj, this.list[dataObj.uid]);
			if(propsWarning) warning += propsWarning + ",";
			let answer = {cmd:dataObj.cmd, transID: dataObj.transID};
			return {answer:answer, error:"", warning:this.correctWarningText(warning), setConfig: true};
		}else{
			return {error:errIdNotFoundTxt}
		}
	}
	selectValuesToJson(selectValues){
		let res = {};
		for(let item of selectValues){
				if(item.name && item.value){
					res[item.value] = item.name;
				}
		}
		return res;
	}
	checkType(type){
		return ['number','select','bool','varchar'].includes(type);
	}
	getNewNodeId(){
		let maxId=0;
		for(let item in this.list){
			let itemInt = parseInt(item);
			if(itemInt && (itemInt > maxId)) maxId = itemInt;
		}
		return maxId + 1;
	}
	addItem(dataObj, nodeList){
		if(!dataObj.name){
			return {error:errNameAbsentTxt};
		}
		let newItem = {};
		let newItemOptions = {};
		newItem.name = dataObj.name;
		if(this.itemType == 'devices'){
			if(dataObj.nodeUid){
				if(this.nodes[dataObj.nodeUid]){
					newItem.nodeUid = dataObj.nodeUid;
				}else{
					return {error:errIdNotFoundTxt};
				}
			}
			newItem.active = true;
		}

		let optionsScheme = config.optionsScheme[this.itemType];
		for(let optionItem in optionsScheme){
			if(!optionsScheme[optionItem].name){
				return {error:errOptionNameAbsentTxt}
			}
			if(!this.checkType(optionsScheme[optionItem].type)){
				return {error:errWrongTypeTxt}
			}
			if((optionsScheme[optionItem].type == 'select') && !optionsScheme[optionItem].selectValues){
				return {error:errSelectValuesAbsentTxt}
			}
			newItemOptions[optionItem] = {};
		}

		newItem.options = newItemOptions;
		let newNodeId = this.getNewNodeId();
		this.list[newNodeId] = newItem;
		dataObj.uid = newNodeId;
		let setAnswer = this.setItem(dataObj);
		if(!setAnswer.error){
		  let answer = {cmd:dataObj.cmd, transID: dataObj.transID, uid:newNodeId};
			return {answer:answer, error:"", warning:setAnswer.warning, setConfig: true};
		}else{
			delete this.list[newNodeId];
			return {error:setAnswer.error};
		}
	}
	correctWarningText(warning){
		if(warning) return warning.slice(0,-1);
		return null;
	}
	deleteItem(dataObj){
		let deleteUids = dataObj.uid;
		let warning = "";
		if(!deleteUids){
			return {error:errUidListTxt}
		}
		for(let item of deleteUids){
			if(this.list[item]){
				delete this.list[item];
			}else{
				warning += errIdNotFoundTxt + ",";
			}
		}
		let answer = {cmd:dataObj.cmd, transID: dataObj.transID};
		return {answer:answer, error:"", warning:this.correctWarningText(warning), setConfig: true};
	}
	getOptionsValuesToObject(items){
		let res = {};
		for(let item in items){
			res[item] = items[item].currentValue;
		}
		return res;
	}
	appendProps(props, container){
		let propsWarning = "";
		[{"propName":"name","type":"varchar"},
		 {"propName":"type","type":"select","selectValues":{"bool":"bool","int":"int","float":"float","datetime":"datetime"}},
		 {"propName":"address","type":"number"},
		 {"propName":"read","type":"bool"},
		 {"propName":"write","type":"bool"}].map((prop)=>{
			if(props[prop.propName] !== undefined){
				if(this.isValueValid(prop,props[prop.propName])){
					container[prop.propName] = props[prop.propName];
				}else{
					if(!propsWarning) propsWarning = errOptionsValidFailTxt;
				}
			}
		});
		return propsWarning;
	}
	getTags(dataObj){
		let device = this.list[dataObj.deviceUid];
		if(!device){
			return {error:errIdNotFoundTxt};
		}
		let res = [];
		if(device.tags){
			for(let item in device.tags){
				let tagItem = {};
				tagItem.uid = item;
				let deviceTag = device.tags[item];
				this.appendProps(deviceTag, tagItem);
				if(dataObj.isOptions){
					tagItem.options = this.getOptionsValuesToObject(deviceTag.options);
				}
				res.push(tagItem);
			}
		}
		let answer = {cmd:dataObj.cmd, transID: dataObj.transID, tags:res};
		return {answer:answer, error:""};
	}
}


//*****************************************************************
// Init options for driver
//*****************************************************************


logger('Get init options');
let config = getConfig();
let nodeList = new ObjList(config.nodes, 'nodes');
let deviceList = new ObjList(config.devices, 'devices', config.nodes);
if(!config) return;
const {orangeScadaPort, orangeScadaHost, ssl, uid, password} = config.driver;
let customDriver = new CustomDriver(nodeList, deviceList, config);


//*****************************************************************
// SERVER PART
//*****************************************************************


// Message text constants

const tryConnectTxt							= 'Try connect to server';
const serverConnectedTxt 				= 'Server connected';
const processExitTxt						= 'Process exit';
const answerTxt									= 'Answer';
const serverRequestTxt					= 'Server request:';
const commandRequestTxt					= 'command request';


// Connect and reconnect to OrangeScada server

const net = require('net');
const tls = require('tls');
const process = require('process');
let server={};
server.connected = false;

const serverReconnectTimeout = 5000;
setInterval(tryConnectServer, serverReconnectTimeout);
tryConnectServer();

function tryConnectServer(){
  if(!server.connected){
    logger(tryConnectTxt);
    server.connected = true;
    if(ssl){
      let options={
        host: orangeScadaHost,
        port: orangeScadaPort,
        rejectUnauthorized: false,
      };
      server.socket = tls.connect(options,() =>{
        logger(serverConnectedTxt);
        handShake();
      });
    }else{
      server.socket = new net.Socket();
      server.socket.connect(orangeScadaPort, orangeScadaHost, () => {
        logger(serverConnectedTxt);
        handShake();
      });
    }
    server.socket.on('data', (data) => {
			parseRequest(data);
    });
    server.socket.on('close',(code, reason) => {
      logger(errServerConnectClosedTxt);
      server.connected=false;
      server.socket.destroy();
    });
    server.socket.on('error',(e) => {
      logger(errServerConnectTxt+' '+e);
      server.connected=false;
      server.socket.destroy();
    });
  };
}

function sendToSocket(data, warning){
	if(!server.connected) return;
	if(warning) data.errorTxt = warning;
	let dataStr = JSON.stringify(data);
	logger(answerTxt+' '+dataStr);
	server.socket.write(dataStr+'\n\r');
}

process.stdin.resume();

process.on('SIGINT', () => {
  logger(processExitTxt);
	server.connected=false;
	server.socket.destroy();
  process.exit();
});


// API requests

// Client first connect
function handShake(){
	let req;
	if(password){
		req = { cmd:'connect', uid:uid, password:password, transID:0 };
	}else{
		req = { cmd:'connect', uid:uid, transID:0 };
	}
	sendToSocket(req);
};

// Parse server requests, execute handlers

function parseRequest(data){
	let dataStr = data.toString().split('\n');
	for(let item of dataStr){
		if(!item) continue;
		logger(serverRequestTxt+' '+item);
		let dataObj = null;
		try{
			dataObj = JSON.parse(item);
		}catch(e){
			logger(errJSONParseTxt+' '+e);
			return;
		}
		if(!dataObj) return;
	  let handler = getHandler(dataObj.cmd);
		if(handler){
			handler(dataObj)
		}else{
			errHandler(errCmdNotRecognizedTxt);
		}
	}
}

// Maping handler for request

function getHandler(cmd){
	switch (cmd) {
		case 'connect'		    			  : return connectServer;
		case 'pingDriver'		    			: return pingDriver;
		case 'getNodes' 		    			: return getNodes;
		case 'pingNode'  		    			: return pingNode;
		case 'getNode'   							: return getNode;
		case 'setNode'   							: return setNode;
		case 'addNode'   							: return addNode;
		case 'deleteNode'   					: return deleteNode;
		case 'getDevices'       			: return getDevices;
		case 'pingDevice'       			: return pingDevice;
		case 'getDevice' 							: return getDevice;
		case 'setDevice' 							: return setDevice;
		case 'addDevice' 							: return addDevice;
		case 'deleteDevice' 					: return deleteDevice;
		case 'getTags' 			    			: return getTags;
		case 'getTag' 			    			: return getTag;
		case 'setTag' 			    			: return setTag;
		case 'addTag' 			    			: return addTag;
		case 'deleteTag' 			    		: return deleteTag;
		case 'getTagsValues' 	  			: return getTagsValues;
		case 'getTagsValuesSubscribe'	: return getTagsValuesSubscribe;
		case 'setTagsValues' 	  			: return setTagsValues;
	//	case 'getAlarms' 	      		: return getAlarms;
	//	case 'setSubscriptionAlarm' : return setSubscriptionAlarm;
		case 'getEvent' 						: return getEvent;
	//	case 'getEvents' 						: return getEvents;
	//	case 'getArchiveTag' 				: return getArchiveTag;
		default: return null;
	}
}

// error handler

function errHandler(errorTxt, dataObj){
	logger('error answer');
	let answer = {};
	if(dataObj && dataObj.cmd) answer.cmd = dataObj.cmd;
	if(dataObj && dataObj.transID) answer.transID = dataObj.transID;
	answer.errorTxt = errorTxt;
	sendToSocket(answer);
}

// connectServer handler

function connectServer() {
	logger('Connect '+commandRequestTxt);
}

// Common handler for requests

function socketCommunicate(res, dataObj) {
	if(res.error == ""){
		sendToSocket(res.answer, res.warning);
		if(res.setConfig) setConfig(config);
	}else{
		errHandler(res.error, dataObj);
	}
}

function commonHandler(dataObj, method){
	logger(dataObj.cmd+' '+commandRequestTxt);
	let res = {};
	let error = "";
	if(!method){
		res.answer = {cmd:dataObj.cmd, transID: dataObj.transID};
		res.error = "";
  }else{
		res = method(dataObj);
	}
  socketCommunicate(res, dataObj);
}

// pingDriver command handler

function pingDriver(dataObj){
	commonHandler(dataObj);
}


//*****************************************************
// You can pass getNodes|pingNode|getNode|setNode|addNode|deleteNode handlers implementation
// if you have not group your devices to nodes. This is not necessary handlers.
//*****************************************************


// getNodes command handler

function getNodes(dataObj){
	commonHandler(dataObj, nodeList.getNodes.bind(nodeList));
}

// pingNode command handler

function pingNode(dataObj){
	commonHandler(dataObj, nodeList.pingItem.bind(nodeList));
}

// getNode command handler

function getNode(dataObj){
	commonHandler(dataObj, nodeList.getItem.bind(nodeList));
}

// setNode command handler

function setNode(dataObj){
	commonHandler(dataObj, nodeList.setItem.bind(nodeList));
}

// addNode command handler

function addNode(dataObj){
	commonHandler(dataObj, nodeList.addItem.bind(nodeList));
}

// deleteNode command handler

function deleteNode(dataObj){
	commonHandler(dataObj, nodeList.deleteItem.bind(nodeList));
}

// getDevices command handler

function getDevices(dataObj){
	commonHandler(dataObj, deviceList.getDevices.bind(deviceList));
}

// pingDevice command handler

function pingDevice(dataObj){
	commonHandler(dataObj, deviceList.pingItem.bind(deviceList));
}

// getDevice command handler

function getDevice(dataObj){
	commonHandler(dataObj, deviceList.getItem.bind(deviceList));
}

// setDevice command handler

function setDevice(dataObj){
	commonHandler(dataObj, deviceList.setItem.bind(deviceList));
}

// addDevice command handler

function addDevice(dataObj){
	commonHandler(dataObj, deviceList.addItem.bind(deviceList));
}

// deleteDevice command handler

function deleteDevice(dataObj){
	commonHandler(dataObj, deviceList.deleteItem.bind(deviceList));
}

// getTags command handler

function getTags(dataObj){
	commonHandler(dataObj, deviceList.getTags.bind(deviceList));
	//commonTagHandler(dataObj,'getTags');
}


// Common handler for tag requests
function commonTagHandler(dataObj, method){
	if(dataObj.deviceUid){
		if(config.devices[dataObj.deviceUid] && config.devices[dataObj.deviceUid].tags){
			let tagList = new ObjList(config.devices[dataObj.deviceUid].tags, 'tags');
			commonHandler(dataObj, tagList[method].bind(tagList));
		}else{
			errHandler(errIdNotFoundTxt, dataObj);
		}
	}else{
		if(method == 'getItem'){
			let tagList = new ObjList({}, 'tags');
			commonHandler(dataObj, tagList[method].bind(tagList));
		}else{
			errHandler(errIdAbsentTxt, dataObj);
		}
	}
}

// getTag command handler
function getTag(dataObj){
	commonTagHandler(dataObj,'getItem');
}

// setTag command handler

function setTag(dataObj){
	commonTagHandler(dataObj,'setItem');
}

// addTag command handler

function addTag(dataObj){
	commonTagHandler(dataObj,'addItem');
}

// deleteTag command handler

function deleteTag(dataObj){
	commonTagHandler(dataObj,'deleteItem');
}

// getTagsValues command handler

function getTagsValues(dataObj){
	customDriver.getTagsValues(dataObj)
	.then(res => socketCommunicate(res), res => socketCommunicate(res, dataObj));
}

// getTagsValuesSubscribe command handler

function getTagsValuesSubscribe(dataObj){
}

// setTagsValues command handler

function setTagsValues(dataObj){
	customDriver.setTagsValues(dataObj)
	.then(res => socketCommunicate(res), res => socketCommunicate(res, dataObj));
}

// getEvent command handler

function getEvent(dataObj){
}
