'use strict'

//*****************************************************************
// This module implements features of your driver, such as
// read|write tags, getting state of activity.
// In this example, we implement Modbus driver,
// you can change all methods for your driver needs
//*****************************************************************

// Error text constants

const net = require("net");

const errDeviceIdNotFoundTxt    = 'Device ID not found';
const errTagNotFoundTxt         = 'Tag not found';
const errTagNotReadableTxt      = 'Tag not readable';
const errTagNotWriteableTxt     = 'Tag not writeable';
const errConfigTxt              = 'Config error';
const errHostCloseConnectTxt    = 'Host close connection';
const errHostUnreachableTxt     = 'Host unreachable';
const errInvalidSetValueTxt     = 'Invalid set value';

const modbusTypes               = ["Coil", "DescreateInput", "HoldingRegister", "InputRegister"];
const modbusErrorCodes          = {0x01: 'Illegal function',
                                   0x02: 'Illegal data address',
                                   0x03: 'Illegal data value',
                                   0x04: 'Server device failure',
                                   0x05: 'Acknowledge',
                                   0x06: 'Server device busy',
                                   0x08: 'Memory parity error',
                                   0x0A: 'Gateway path unavailable',
                                   0x0B: 'Gateway target device failed to respond'
                                  }
const modbusCmdCodes            = [0x01, 0x02, 0x03, 0x04];
const modbusWriteSingleCoil     = 0x05;
const modbusWriteSingleHold     = 0x06;
const modbusWriteMultiCoil      = 0x0F;
const modbusWriteMultiHold      = 0x10;

const typesLength               = {};
typesLength['Int']              = 1;
typesLength['UInt']             = 1;
typesLength['Long']             = 2;
typesLength['ULong']            = 2;
typesLength['Float']            = 2;
typesLength['Double']           = 4;

const defaultTimeout            = 10000;
const subscribeTimerCycle       = 1000;
const defaultModbusDisplayType  = 'UInt';
const defaultModbusBytesOrder   = 'BE';

class CustomDriver{

  constructor(nodeList, deviceList, config, subscribeHandler){
    this.nodeList = nodeList;
    this.deviceList = deviceList;
    this.config = config;
    this.connections = {};
    this.clients = {}; // HERE !!!!
    this.requestCounter = 0;
    this.subscribeHandler = subscribeHandler;
    this.updateSubscribe();
    setInterval(this.subscribeTimer.bind(this), subscribeTimerCycle);
  }

  getTagsValues(dataObj){
    return new Promise((resolve, reject) => {
      let res = {};
      res.answer = {cmd:dataObj.cmd, transID: dataObj.transID};
      this.getTagsList('read', dataObj)
      .then(tags => this.modbusReadRequest(tags, dataObj.transID))
      .then(values => {
        res.answer.values = values;
        res.error = "";
        resolve(res);
      })
      .catch(err => {
        res.error = err;
        reject(res);
      })
  	})
  }

  setTagsValues(dataObj){
    return new Promise((resolve, reject) => {
      let res = {};
      res.answer = {cmd:dataObj.cmd, transID: dataObj.transID};
      let multiWriteEnable = this.isMultiWriteEnable(dataObj);
      this.getTagsList('write', dataObj)
      .then(tags => this.modbusWriteRequest(tags, dataObj.transID, multiWriteEnable))
      .then( _ => {
        res.error = "";
        resolve(res);
      })
      .catch(err => {
        res.error = err;
        reject(res);
      })
    })
  }

  updateSubscribe(){
    this.subscribed = {};
    for(let item in this.config.devices){
      let tags = this.config.devices[item].tags;
      if(tags){
        for (let tag in tags){
          if(tags[tag].subscribed) this.subscribed[item + ':' + tag] = {tagname: tag, device: item, value: undefined, isRequested: false};
        }
      }
    }
  }

  subscribeTimer(){
    if(!this.subscribed) return;
    //HERE
    let requestSubscribedObj = {};
    for(let index in this.subscribed){
      let item = this.subscribed[index];
      if(!item.isRequested){
        if(requestSubscribedObj[item.device] === undefined){
          requestSubscribedObj[item.device] = [];
        }
        requestSubscribedObj[item.device].push(item);
        item.isRequested = true;
      }
    }
    this.requestSubscribed(requestSubscribedObj);
  }

  requestSubscribed(requestSubscribedObj){
    //HERE
    let dataObj = {cmd: 'getTagsValues', transID: 0};
    for(let item in requestSubscribedObj){
      let tags = [];
      dataObj.deviceUid = item;
      for(let tag in requestSubscribedObj[item]){
        tags.push(requestSubscribedObj[item][tag].tagname);
      }
      if(tags){
        dataObj.tags = tags;
        this.getTagsValues(dataObj)
        .then(res => this.setSubscribedValues(dataObj, res), res => this.setSubscribedValues(dataObj, res)); 
      }
    }
  }

  setSubscribedValues(dataObj, res){
    let resIndex = 0;
    let sendSubscribedObj = {};
    sendSubscribedObj.deviceUid = dataObj.deviceUid;
    sendSubscribedObj.values = [];
    for(let tag of dataObj.tags){
      let index = dataObj.deviceUid + ':' + tag;
      if(this.subscribed[index]){
        this.subscribed[index].isRequested = false;
        let newValue = !res.error && res.answer && res.answer.values && (res.answer.values[resIndex] !== undefined) ? res.answer.values[resIndex] : null;
          if(this.subscribed[index].value !== newValue){
            this.subscribed[index].value = newValue;
            sendSubscribedObj.values.push({tag: tag, value: this.subscribed[index].value});
        }
      }
      resIndex++;
    }
    if(sendSubscribedObj.values.length) this.subscribeHandler(sendSubscribedObj);
  }

  isMultiWriteEnable(dataObj){
    let res = false;
    let device = this.deviceList.list ? this.deviceList.list[dataObj.deviceUid] : null;
    if (device && device.options && device.options.multiWriteEnable && device.options.multiWriteEnable.currentValue) res = true;
    return res;
  }

  getTagsList(cmd, dataObj){
    return new Promise((resolve, reject) => {
      let device = this.deviceList.list  ? this.deviceList.list[dataObj.deviceUid] : null;
      if(!device){
        reject(errDeviceIdNotFoundTxt);
        return;
      }
      let tags = [];
      for(let item of dataObj.tags){
        let tag = null;
        let tagName = null;
        if(cmd == 'read') tag = device.tags ? device.tags[item] : null;
        if(cmd == 'write'){
          tagName = Object.keys(item)[0];
          if(tagName !== null) tag = device.tags ? device.tags[tagName] : null;
        }
        if(!tag){
          reject(errTagNotFoundTxt);
          return;
        }
        if((cmd == 'read')  && !tag.read){
          reject(errTagNotReadableTxt);
          return;
        }
        if((cmd == 'write')  && !tag.write){
          reject(errTagNotWriteableTxt);
          return;
        }
        if ((cmd == 'write') &&
            ((tag.options.modbusVarType.currentValue == 'DiscreteInput') ||
             (tag.options.modbusVarType.currentValue == 'InputRegister'))){
          reject(errTagNotWriteableTxt);
          return;
        }

        let tagItem = {};
        try{
          tagItem.modbusVarAddress = tag.options.modbusVarAddress.currentValue;
          tagItem.modbusVarType = tag.options.modbusVarType.currentValue;
          tagItem.modbusId = device.options.modbusId.currentValue;
          tagItem.timeout = device.options.timeout.currentValue;
          tagItem.modbusDisplayType = tag.options.modbusDisplayType && tag.options.modbusDisplayType.currentValue ?
                                      tag.options.modbusDisplayType.currentValue : defaultModbusDisplayType;
          tagItem.modbusBytesOrder  = tag.options.modbusBytesOrder && tag.options.modbusBytesOrder.currentValue ?
                                      tag.options.modbusBytesOrder.currentValue : defaultModbusBytesOrder;
          tagItem.ip = this.nodeList.list[device.nodeUid].options.modbusHost.currentValue;
          tagItem.port = this.nodeList.list[device.nodeUid].options.modbusPort.currentValue;
          if(cmd == 'read'){
            tagItem.name = item;
          }
          if(cmd == 'write'){
            tagItem.name = tagName;
            tagItem.setValue = item[tagName];
          }
        }catch(e){
          reject(errConfigTxt);
          return;
        }
        tags.push(tagItem);
      }
      resolve(tags);
    });
  }

  modbusReadRequest(tags, transID){
    return new Promise((resolve,reject) => {
      let requests = this.prepareRequests('read', tags);
      let buffer = this.prepareBuffer('read', requests, tags);
      this.sendBufferToSocket('read', buffer, tags, requests, transID)
      .then( values => resolve(values))
      .catch(err => {
        console.log(err);
        reject(err);
      })
      .finally( _ => {
        let fullDeviceName = this.getFullDeviceAddress(tags);
        delete this[fullDeviceName][transID];
      });
    })
  }

  modbusWriteRequest(tags, transID, multiWriteEnable){
    return new Promise((resolve, reject) => {
      try{
        let requests = this.prepareRequests('write', tags, multiWriteEnable);
        let buffer = this.prepareBuffer('write', requests, tags, multiWriteEnable);
        this.sendBufferToSocket('write', buffer, tags, requests, transID)
        .then( _ => resolve())
        .catch(err => {
          console.log(err);
          reject(err);
        })
        .finally( _ => {
          let fullDeviceName = this.getFullDeviceAddress(tags);
          delete this[fullDeviceName][transID];
        });
      }catch(err){
        reject(err.message);
      }
    })
  }

  sendBufferToSocket(cmd, buffer, tags, requests, transID){
    let chain = Promise.resolve();
    let fullDeviceName = this.getFullDeviceAddress(tags);
    if (!this[fullDeviceName]) this[fullDeviceName] = {};
    this[fullDeviceName][transID] = {};
    this[fullDeviceName][transID].values = {};
    if (!this.connections[fullDeviceName]){
      chain = chain.then( _ => this.createConnect(tags, fullDeviceName));
    }
    buffer.forEach((item) => {
      chain = chain.then( _ => this.checkConnected(fullDeviceName, tags, item));
      chain = chain.then( _ => this.checkSocketReady(fullDeviceName, tags, item));
      chain = chain.then( _ => this.sendToSocket(item, this.connections[fullDeviceName]));
      chain = chain.then( _ => this.waitAnswer(item, this.connections[fullDeviceName], tags));
      chain = chain.then( result => this.parseResult(cmd, result, tags, requests, transID));
    });
    chain = chain.then( _ => this.finishParse(cmd, tags, transID));
    return chain;
  }

  addResolveQueue(client, resolve, type){
    if(!client[type]) client[type] = [];
    client[type].push(resolve);
  }

  checkConnected(fullDeviceName, tags, item){
    return new Promise((resolve) => {
      let client = this.connections[fullDeviceName];
      if(client.connected){
        resolve();
        return;
      }else{
        this.addResolveQueue(client, resolve, 'waitConnectResolves');
      }
      let timeout = this.getTimeout(tags) || defaultTimeout;
      setTimeout( _ => resolve(), timeout);
    })
  }

  checkSocketReady(fullDeviceName, tags, item){
    return new Promise((resolve) => {
      let client = this.connections[fullDeviceName];
      if(!client.waitresponse){
        client.waitresponse = {};
        resolve();
        return;
      }else{
        this.addResolveQueue(client, resolve, 'nextRequestResolves');
      }
      let timeout = this.getTimeout(tags) || defaultTimeout;
      setTimeout( _ => resolve(), timeout);
    })
  }

  createConnect(tags, fullDeviceName){
    return new Promise((resolve, reject) => {
      let client = new net.Socket();
      this.connections[fullDeviceName] = client;
      client.fullDeviceAddress = this.getFullDeviceAddress(tags);
      client.connect(this.getPort(tags), this.getHost(tags), _ => {
        client.connected = true;
        resolve(client);
        if(client.waitConnectResolves){
          for(let resolve of client.waitConnectResolves){
            setTimeout( _ => resolve() , 0);
          }
          client.waitConnectResolves = null;
        }
      });
      client.on("data", data => {
        this.response(client, data);
      });
      client.on("close", _ => {
        delete this.connections[client.fullDeviceAddress];
        client.connected = false;
        reject(errHostCloseConnectTxt);
      });
      client.on("error", data => {
        delete this.connections[client.fullDeviceAddress];
        client.connected = false;
        reject(errHostUnreachableTxt);
      });
    });
  }

  sendToSocket(request, client){
    try{
      client.write(request);
    }
    catch(err){
      console.log(err);
    }
  }

  // response handler for incoming packets
  response(client, data){
    let responsePacket = new Packet;
    if(client.waitresponse && client.waitresponse.requestId     ==   responsePacket.getId(data)
                           && client.waitresponse.modbusAddress ==   responsePacket.getModbusAddress(data)
                           && client.waitresponse.modbusFunc    ==   responsePacket.getModbusFunc(data)){
      if (responsePacket.getModbusErrorStatus(data)){
        let errCode = responsePacket.getModbusErrorCode(data); 
        let errTxt = (errCode && modbusErrorCodes[errCode]) ? modbusErrorCodes[errCode] : 'Unknowng Modbus Error';
        client.waitresponse.reject(errTxt);
      }else{
        client.waitresponse.resolve(data);
      }
      if(client.nextRequestResolves){
        let resolve = client.nextRequestResolves.shift();
        if(resolve) resolve();
      }
      client.waitresponse = null;
    }
  }

  parseResult(cmd, data, tags, requests, transID){
    if(cmd == 'read'){
      let responsePacket = new Packet;
      let valuesData = responsePacket.getValues(data);
      let packetId = responsePacket.getId(data);
      for (let request of requests){
        for(let item of request){
          if(item.requestCounter == packetId){
            this.valuesAssign(item, tags, valuesData, transID);
            break;
          }
        }
      }
    }
  }

  waitAnswer(request, client, tags){
    return new Promise((resolve, reject) => {
      let requestPacket = new Packet;
      client.waitresponse = {resolve: resolve, reject: reject, requestId: requestPacket.getId(request), modbusAddress: requestPacket.getModbusAddress(request), modbusFunc: requestPacket.getModbusFunc(request) };
      let timeout = this.getTimeout(tags) || defaultTimeout;
      setTimeout( _ => resolve(null), timeout);
    });
  }

  prepareBuffer(cmd, requests, tags, multiWriteEnable = true){
    let buffers = [];
    let modbusDeviceId = this.getModbusDeviceId(tags);
    if(!modbusDeviceId) return null;
    for (let i = 0; i < modbusCmdCodes.length; i++){
      if(requests[i]){
        for (let item of requests[i]){
          let buffArr = [];
          if(cmd == 'read') buffArr = this.getReadBuffArr(item, modbusDeviceId, modbusCmdCodes[i]);
          if(cmd == 'write') buffArr = this.getWriteBuffArr(item, modbusDeviceId, modbusTypes[i], multiWriteEnable);
          buffers.push(Buffer.from(buffArr));
        }
      }
    }
    return buffers;
  }

  getReadBuffArr(item, modbusDeviceId, modbusCode){
    const modbusProtocolId = 0;
    const packetLength = 6;
    let buffArr = [];
    let requestCounter = this.getRequestCounter();
    item.requestCounter = requestCounter;
    this.addWord(buffArr, requestCounter);
    this.addWord(buffArr, modbusProtocolId);
    this.addWord(buffArr, packetLength);
    buffArr.push(modbusDeviceId);
    buffArr.push(modbusCode);
    this.addWord(buffArr, item.start);
    this.addWord(buffArr, item.count);
    return buffArr;
  }

  getWriteBuffArr(item, modbusDeviceId, modbusType, multiWriteEnable){
    const modbusProtocolId = 0;
    const packetLength = this.getModbusPacketLength(item, modbusType, multiWriteEnable);
    let buffArr = [];
    let requestCounter = this.getRequestCounter();
    item.requestCounter = requestCounter;
    this.addWord(buffArr, requestCounter);
    this.addWord(buffArr, modbusProtocolId);
    this.addWord(buffArr, packetLength);
    buffArr.push(modbusDeviceId);
    buffArr.push(this.getModbusWriteCode(modbusType, multiWriteEnable));
    this.addWord(buffArr, item.start);
    if(multiWriteEnable){
      this.addWord(buffArr, item.count);
      buffArr.push(this.getModbusBytesCountLeft(item, modbusType));
    }
    this.pushSetValues(buffArr, item, modbusType, multiWriteEnable);
    return buffArr;
  }

  getModbusPacketLength(item, modbusType, multiWriteEnable){
    if(!multiWriteEnable) return 6;
    if(modbusType == 'Coil'){
      return 7 + this.getModbusBytesCountLeft(item, modbusType);
    }
    if(modbusType == 'HoldingRegister'){
      return 7 + this.getModbusBytesCountLeft(item, modbusType);
    }
    throw new Error('Cannot calc packet length: unsupported write type');
  }

  getModbusBytesCountLeft(item, modbusType){
    if(modbusType == 'Coil'){
      return Math.ceil(item.count / 8);
    }
    if(modbusType == 'HoldingRegister'){
      return 2 * item.count;
    }
    return null;
  }

  pushSetValues(buffArr, item, modbusType, multiWriteEnable){
    const getLastElemValue = (item, i) => {
      let res = {};
      if(item.tags.length > i){
        let valuesArr = item.tags[i];
        if(valuesArr.length > 0){
          let valuesElem = valuesArr[valuesArr.length - 1];
          res.value1 = valuesElem.value1;
          res.value2 = valuesElem.value2;
        }
      }
      if(!res) throw new Error('Set value index error');
      return res;
    }
    if(!multiWriteEnable){
      let setValue = getLastElemValue(item, 0);
      if(modbusType == 'Coil'){
        if((setValue.value1 + setValue.value2) !== 0){
          buffArr.push(0xFF);
          buffArr.push(0x00);
        }else{
          buffArr.push(0x00);
          buffArr.push(0x00);
        }
      }
      if(modbusType == 'HoldingRegister'){
        buffArr.push(setValue.value1);
        buffArr.push(setValue.value2);
      }
    }else{ // multiWriteEnable = true
      if(modbusType == 'Coil'){
        for(let i = 0; i < this.getModbusBytesCountLeft(item, modbusType); i++){
          let byteValue = 0;
          for(let j = 0; j < 8; j++){
            if(item.tags.length > i + j){
              let setValue = getLastElemValue(item, i + j);
              if((setValue.value1 + setValue.value2) !== 0){
                byteValue += (1 << j);
              }
            }
          }
          buffArr.push(byteValue);
        }
      }
      if(modbusType == 'HoldingRegister'){
        for(let i = 0; i < item.count; i++){
          let setValue = getLastElemValue(item, i);
          buffArr.push(setValue.value1);
          buffArr.push(setValue.value2);
        }
      }
    }
  }

  getModbusWriteCode(modbusType, multiWriteEnable){
    if((modbusType == 'Coil') && !multiWriteEnable) return modbusWriteSingleCoil;
    if((modbusType == 'Coil') && multiWriteEnable) return modbusWriteMultiCoil;
    if((modbusType == 'HoldingRegister') && !multiWriteEnable) return modbusWriteSingleHold;
    if((modbusType == 'HoldingRegister') && multiWriteEnable) return modbusWriteMultiHold;
    throw new Error('Cannot get modbus code: unsupported write type');
  }

  addWord(arr, value){
    arr.push((value & 0xFF00) >> 8);
    arr.push(value & 0xFF);
  }

  getRequestCounter(){
    if (this.requestCounter > 0xFFFF) this.requestCounter = 0;
    return this.requestCounter++;
  }

  getTypeLength(item){
    if ((item.modbusVarType == 'Coil') || (item.modbusVarType == "DescreateInput")) return 1;
    let typeName = item.modbusDisplayType;
    if(!typeName) return 1;
    let len = typesLength[typeName];
    if(len) return len;
    return 1;
  }

  prepareRequests(cmd, tags, multiWriteEnable = true){
    let requests = [];
    let registers = {};
    modbusTypes.forEach((item) => {
      registers[item] = [];
    });
    for (let item of tags){
      let len = this.getTypeLength(item);
      let valueWriteParts = [];
      if(cmd == 'write'){
        if (!this.checkSetValue(item)) throw new Error(errInvalidSetValueTxt);
        valueWriteParts = this.getValueWriteParts(item);
      }
      for(let i = 0; i < len; i++){
        if(cmd == 'read'){
          registers[item.modbusVarType].push({"tag": i.toString() + item.name, "address": item.modbusVarAddress + i});
        }else{
          registers[item.modbusVarType].push({"tag": i.toString() + item.name, "address": item.modbusVarAddress + i,
                                              "value1": valueWriteParts[i].d0, "value2": valueWriteParts[i].d1});
        }
      }
    }
    modbusTypes.forEach((item) => {
      requests.push(this.getRequestByType(cmd, registers, item, multiWriteEnable));
    });
    return requests;
  }

  getValueWriteParts(valueObj){
    let res = [];
    valueObj.modbusDisplayType = valueObj.modbusDisplayType || defaultModbusDisplayType;
    valueObj.modbusBytesOrder = valueObj.modbusBytesOrder || defaultModbusBytesOrder;
    let regsCount = this.getTypeLength(valueObj);
    this.encodeValue(valueObj);
    this.swapBytes(valueObj);
    for (let i = 0; i < regsCount; i++) {
      res.push(valueObj[i]);
    }
    return res;
  }

  encodeValue(valueObj){
    switch (valueObj.modbusDisplayType) {
      case 'Int': case 'Long': case 'UInt': case 'ULong':
        return this.uniEncodeIntValue(valueObj);
      case 'Float': case 'Double':
        return this.encodeFloatValue(valueObj);
      default:
        return this.uniEncodeIntValue(valueObj);
    }
  }

  uniEncodeIntValue(valueObj){
    let value = valueObj.setValue;
    let regsCount = this.getTypeLength(valueObj);
    let maxCapacity = this.getMaxCapacity(regsCount);
    if(value < 0) value += maxCapacity;
    for(let i = 0; i < regsCount; i++){
      let regValue = value >> ((regsCount - i - 1) * 16);
      valueObj[i] = {};
      valueObj[i].d0 = (regValue >> 8) & 0x00FF;
      valueObj[i].d1 = regValue & 0x00FF;
    }
  }

  encodeFloatValue(valueObj){
    let value = valueObj.setValue;
    let regsCount = this.getTypeLength(valueObj);
    let buffer = new ArrayBuffer(2 * regsCount + 1);
    let view = new DataView(buffer);
    if(regsCount == 2){
      view.setFloat32(0, value);
    }else if(regsCount == 4){
      view.setFloat64(0, value);
    }else{
      throw new Error('Wrong float value size');
    }
    let int8Buf = new Uint8Array(buffer);
    for(let i = 0; i < regsCount; i++){
      valueObj[i] = {};
      valueObj[i].d0 = int8Buf[2 * i];
      valueObj[i].d1 = int8Buf[2 * i + 1];;
    }
  }

  checkSetValue(valueObj){
    let value = valueObj.setValue;
    if (typeof(value) !== 'number') return false;
    if ((valueObj.modbusDisplayType == 'Float') || (valueObj.modbusDisplayType == 'Double')) return true;
    let regsCount = this.getTypeLength(valueObj);
    let signed = this.isTypeSigned(valueObj.modbusDisplayType);
    let maxCapacity = this.getMaxCapacity(regsCount);
    if(signed){
      return ((value >= -maxCapacity / 2) && (value <= maxCapacity / 2 - 1));
    }else{
      return ((value >= 0) && (value < maxCapacity));
    }
  }

  getRequestByType(cmd, registers, type, multiWriteEnable){
    const getTag = (cmd, item) => {
      if(cmd == 'read') return item.tag;
      if(cmd == 'write') return {'tagName': item.tag, 'value1': item.value1, 'value2': item.value2}
      return null;
    }
    const maxRegReadCount = 125;
    const maxCoilReadCount = 2000;
    let maxReadCount = ((type == "Coil") || (type == "DescreateInput")) ? maxCoilReadCount : maxRegReadCount;
    let requests = [];
    let counter = 0;
    let startIndex = -1;
    let tags = [];
    let requestsTags = [];
    let sortedRegs = this.getSortedRegs(registers[type]);
    for(let item of sortedRegs){
      if(!counter){
        startIndex = item.address;
        tags.push(getTag(cmd, item));
        counter++;
      }else{
        let prevIndex = startIndex + counter - 1;
        if(prevIndex == item.address) tags.push(getTag(cmd, item));
        if(((item.address - prevIndex) == 1) && (counter < maxReadCount) && multiWriteEnable){
          requestsTags.push(tags);
          tags = [getTag(cmd, item)];
          counter++;
        }else if(((item.address - prevIndex) > 1) || (counter == maxReadCount) || !multiWriteEnable){
          requestsTags.push(tags);
          requests.push({"start": startIndex, "count": counter, "tags": requestsTags, "type": type});
          requestsTags = [];
          startIndex = item.address;
          tags = [getTag(cmd, item)];
          counter = 1;
        }
      }
    }
    if(counter){
      requestsTags.push(tags);
      requests.push({"start": startIndex, "count": counter, "tags": requestsTags, "type": type});
    }
    return requests;
  }

  getTagsObj(tags){
    let res = {};
    for (let tag of tags){
      if(tag.name) res[tag.name] = tag;
    }
    return res;
  }

  valuesAssign(item, tags, data, transID){
    // item : start - first mobus address, count - number of addresses, tags - array [0..count - 1] of arrays with tags
    // type - modbusType, requestCounter - PacketId

    // tags : array of modbus vars (modbusVarAddress, modbusVarType, modbusId, timeout, modbusDisplayType, modbusBytesOrder, ip, port, name)

    // data - response buffer

    let fullDeviceName = this.getFullDeviceAddress(tags);
    let tagsObj = this.getTagsObj(tags);
    let buffer = {};
    for(let i = 0; i < item.tags.length; i++){
      let isDescreate = ((item.type == 'Coil') || (item.type == 'DescreateInput'));
      for(let j = 0; j < item.tags[i].length; j++){
        let itemName = item.tags[i][j].slice(1);
        if(isDescreate){
          this[fullDeviceName][transID].values[itemName] = this.parseDiscreateValue(i, data);
        }else{
          if(!buffer[itemName]){
            buffer[itemName] = {};
            let mdt = tagsObj[itemName].modbusDisplayType;
            if(mdt) buffer[itemName].modbusDisplayType = mdt;
            let mbo = tagsObj[itemName].modbusBytesOrder;
            if(mbo) buffer[itemName].modbusBytesOrder = mbo;
            buffer[itemName].modbusVarType = tagsObj[itemName].modbusVarType;
          }
          let tagIndex = item.tags[i][j].slice(0,1);
          buffer[itemName][tagIndex] = {};
          if(data.length > i * 2 + 1){
            buffer[itemName][tagIndex].d0 = data[i * 2];
            buffer[itemName][tagIndex].d1 = data[i * 2 + 1];
          }
        }
      }
    }
    for(let itemName in buffer){
      this[fullDeviceName][transID].values[itemName] = this.parseValue(buffer[itemName]);
    };
  }

  parseValue(valueObj){
    this.swapBytes(valueObj);
    let signed = this.isTypeSigned(valueObj.modbusDisplayType);
    switch (valueObj.modbusDisplayType) {
      case 'Int': case 'Long':
        return this.uniParseIntValue(valueObj, signed);
      case 'UInt': case 'ULong':
        return this.uniParseIntValue(valueObj, signed);
      case 'Float':
        return this.parseFloatValue(valueObj, false);
      case 'Double':
        return this.parseFloatValue(valueObj, true);
      default:
        return this.uniParseIntValue(valueObj, signed);
    }
  }

  isTypeSigned(mdt){
    if ((mdt == 'UInt') || (mdt == 'ULong')) return false;
    return true;
  }

  getBytesArr(valueObj){
    let regsCount = this.getTypeLength(valueObj);
    let bytesArr = [];
    for(let i = 0; i < regsCount; i++){
      bytesArr.push(valueObj[i].d0);
      bytesArr.push(valueObj[i].d1);
    }
    return bytesArr;
  }

  swapBytes(valueObj){
    if(valueObj.modbusBytesOrder == 'BE') return;
    let regsCount = this.getTypeLength(valueObj);
    let bytesArr = this.getBytesArr(valueObj);
    if(valueObj.modbusBytesOrder.includes('LE')){
      for(let i = 0; i < regsCount; i++){
        let tmp = bytesArr[i];
        bytesArr[i] = bytesArr[regsCount * 2 - i - 1];
        bytesArr[regsCount * 2 - i - 1] = tmp;
      }
    }
    if(valueObj.modbusBytesOrder.includes('S')){
      for(let i = 0; i < regsCount; i++){
        let tmp = bytesArr[2 * i];
        bytesArr[2 * i] = bytesArr[2 * i + 1];
        bytesArr[2 * i + 1] = tmp;
      }
    }
    for(let i = 0; i < regsCount; i++){
      valueObj[i].d0 = bytesArr[2 * i];
      valueObj[i].d1 = bytesArr[2 * i + 1];
    }
  }

  uniParseIntValue(valueObj, signed){
    let regsCount = this.getTypeLength(valueObj);
    if(!this.checkValueInfo(valueObj, regsCount)) return null;
    let bytesArr = this.getBytesArr(valueObj);
    let value = 0;
    for(let i = 0; i < 2 * regsCount; i++){
      let coef = BigInt(1);
      coef <<= BigInt((2 * regsCount - i - 1) * 8);
      coef = Number(coef);
      value += coef * bytesArr[i];
    }
    if(!signed) return value;
    let maxCapacity = this.getMaxCapacity(regsCount);
    return (value >= maxCapacity / 2) ? value - maxCapacity : value;
  }

  getMaxCapacity(regsCount){
    let maxCapacity = BigInt(1);
    maxCapacity <<= BigInt(16 * regsCount);
    maxCapacity = Number(maxCapacity);
    return maxCapacity;
  }

  parseFloatValue(valueObj, double){
    let bytesArr = this.getBytesArr(valueObj);
    let aBuf = new ArrayBuffer(bytesArr.length);
    let view = new DataView(aBuf);
    bytesArr.forEach(function (b, i) {
      view.setUint8(i, b);
    });
    let res = double ? view.getFloat64(0) : view.getFloat32(0);
    return res;
  }

  checkValueInfo(valueObj, regsCount){
    for(let i = 0; i < regsCount; i++){
      if(!valueObj[i]) return false;
      if(valueObj[i].d0 === undefined || valueObj[i].d1 === undefined) return false;
    }
    return true;
  }

  parseDiscreateValue(i, data){
      if(data.length > i / 8){
        let bit = i % 8;
        let mask = 1 << bit;
        return (data[parseInt(i / 8)] & mask) > 0 ? 1 : 0;
      }
      return null;
  }

  finishParse(cmd, tags, transID){
    let fullDeviceName = this.getFullDeviceAddress(tags);
    let values = [];
    if(cmd == 'read'){
      for(let tag of tags){
        if(this[fullDeviceName][transID].values){
          values.push(this[fullDeviceName][transID].values[tag.name])
        }else{
          values.push(null);
        }
      }
    }
    return values;
  }

  getSortedRegs(regs){
      regs.sort((a, b) => a.address - b.address);
      return regs;
  }

  getHost(tags){
    if (tags && tags[0] && tags[0].ip) return tags[0].ip;
    return null;
  }

  getPort(tags){
    if (tags && tags[0]) return tags[0].port;
    return null;
  }

  getModbusDeviceId(tags){
    if (tags && tags[0]) return tags[0].modbusId;
    return null;
  }

  getTimeout(tags){
    if (tags && tags[0]) return tags[0].timeout;
    return null;
  }

  getFullDeviceAddress(tags){
    if ((this.getHost(tags) !== null) && (this.getPort(tags) !== null))  return this.getHost(tags) + ':' + this.getPort(tags);
    return null;
  }

}

class Packet {

  constructor(){
    this.packetIdIndex              = 0;
    this.packetModbusAddressIndex   = 6;
    this.packetModbusFuncIndex      = 7;
    this.packetModbusErrorCodeIndex = 8;
    this.packetModbusLenIndex       = 8;
    this.packetValuesIndex          = 9;
  }

  getWord(request, index){
    if(request && request.length >= index + 2) return 0x100 * request[index] + request[index + 1];
    return null;
  }

  getByte(request, index){
    if(request && request.length >= index) return request[index];
    return null;
  }

  getId(buffer){
    return this.getWord(buffer, this.packetIdIndex);
  }

  getModbusAddress(buffer){
    return this.getByte(buffer, this.packetModbusAddressIndex);
  }

  getModbusFunc(buffer){
    let modbusCode = this.getByte(buffer, this.packetModbusFuncIndex);
    return modbusCode & 0x7F;
  }

  getModbusErrorStatus(buffer){
    let modbusCode = this.getByte(buffer, this.packetModbusFuncIndex);
    return (modbusCode & 0x80) > 0;
  }

  getModbusErrorCode(buffer){
    return this.getByte(buffer, this.packetModbusErrorCodeIndex);
  }

  getValues(buffer){
    let len = this.getByte(buffer, this.packetModbusLenIndex);
    if(len) return buffer.slice(this.packetValuesIndex, this.packetValuesIndex + len);
    return null;
  }
}


module.exports = CustomDriver;
