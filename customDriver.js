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

const modbusTypes               = ["Coil", "DescreateInput", "HoldingRegister", "InputRegister"];
const modbusCmdCodes            = [1, 2, 3, 4];

const typesLength               = {};
typesLength['Int']              = 1;
typesLength['UInt']             = 1;
typesLength['Long']             = 2;
typesLength['ULong']            = 2;
typesLength['Float']            = 2;
typesLength['Double']           = 4;

const defaultTimeout            = 10000;
const defaultModbusDisplayType  = 'UInt';
const defaultModbusBytesOrder   = 'BE';

class CustomDriver{

  constructor(nodeList, deviceList, config){
    this.nodeList = nodeList;
    this.deviceList = deviceList;
    this.config = config;
    this.connections = {};
    this.requestCounter = 0;
  }

  getTagsValues(dataObj){
    return new Promise((resolve, reject) => {
      let res = {};
      res.answer = {cmd:dataObj.cmd, transID: dataObj.transID};
      this.getTagsList('read', dataObj)
      .then(tags => this.modbusRequest('read', tags, dataObj.transID))
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
      .then(tags => this.modbusRequest('write', tags, dataObj.transID, multiWriteEnable))
      .then( _ => {
      //  res.answer.values = values;
        res.error = "";
        resolve(res);
      })
      .catch(err => {
        res.error = err;
        reject(res);
      })
    })
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
        if(!tag.read){
          reject(errTagNotReadableTxt);
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

  modbusRequest(cmd, tags, transID, multiWriteEnable = false){
    if(cmd == 'read') return this.modbusReadRequest(tags, transID);
    if(cmd == 'write') return this.modbusWriteRequest(tags, transID, multiWriteEnable);
  }

  modbusReadRequest(tags, transID){
    return new Promise((resolve,reject) => {
      let values = [];
      let requests = this.prepareRequests('read', tags);
      let buffer = this.prepareReadBuffer(requests, tags);
      this.sendBufferToSocket(buffer, tags, requests, transID)
      .then( values => resolve(values))
      .catch(err => {
        console.log(err);
        reject(err);
      });
    })
  }

  modbusWriteRequest(tags, transID, multiWriteEnable){
    return new Promise((resolve, reject) => {
      //TODO
      let requests = this.prepareRequests('write', tags);
      let buffer = this.prepareWriteBuffer(requests, tags, multiWriteEnable);
    })
  }

  sendBufferToSocket(buffer, tags, requests, transID){
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
        chain = chain.then( result => this.parseResult(result, tags, requests, transID));
    });
    chain = chain.then( _ => this.finishParse(tags, transID));
    return chain;
  }

  addResolveQueue(client, resolve, type){
    if(!client[type]) client[type] = [];
    client[type].push(resolve);
  }

  checkConnected(fullDeviceName, tags, item){
    return new Promise((resolve) => {
      let client = this.connections[fullDeviceName];
      if(client.fullDeviceAddress){
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
      client.connect(this.getPort(tags), this.getHost(tags), _ => {
        client.fullDeviceAddress = this.getFullDeviceAddress(tags);
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
        reject(errHostCloseConnectTxt);
      });
      client.on("error", data => {
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

  response(client, data){
    let responsePacket = new Packet;
    if(client.waitresponse && client.waitresponse.requestId     ==   responsePacket.getId(data)
                           && client.waitresponse.modbusAddress ==   responsePacket.getModbusAddress(data)
                           && client.waitresponse.modbusFunc    ==   responsePacket.getModbusFunc(data)){
      client.waitresponse.resolve(data);
      if(client.nextRequestResolves){
        let resolve = client.nextRequestResolves.shift();
        if(resolve) resolve();
      }
      client.waitresponse = null;
    }
  }

  parseResult(data, tags, requests, transID){
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

  waitAnswer(request, client, tags){
    return new Promise( resolve => {
      let requestPacket = new Packet;
      client.waitresponse = { resolve: resolve, requestId: requestPacket.getId(request), modbusAddress: requestPacket.getModbusAddress(request), modbusFunc: requestPacket.getModbusFunc(request) };
      let timeout = this.getTimeout(tags) || defaultTimeout;
      setTimeout( _ => resolve(null), timeout);
    });
  }

  prepareReadBuffer(requests, tags){
    let buffers = [];
    let modbusDeviceId = tags && tags[0] ? tags[0].modbusId : null;
    if(!modbusDeviceId) return null;
    for (let i = 0; i < modbusCmdCodes.length; i++){
      if(requests[i]){
        for (let item of requests[i]){
          let buffArr = this.getBuffArr(item, modbusDeviceId, modbusCmdCodes[i]);
          buffers.push(Buffer.from(buffArr));
        }
      }
    }
    return buffers;
  }

  prepareWriteBuffer(requests, tags, multiWriteEnable){
    // HERE
    let buffers = [];
    let modbusDeviceId = tags && tags[0] ? tags[0].modbusId : null;
    if(!modbusDeviceId) return null;
    for (let i = 0; i < modbusCmdCodes.length; i++){
      if(requests[i]){
        for (let item of requests[i]){
          let buffArr = this.getBuffArr(item, modbusDeviceId, modbusCmdCodes[i]);
          buffers.push(Buffer.from(buffArr));
        }
      }
    }
    return buffers;
  }

  getBuffArr(item, modbusDeviceId, modbusCode){
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

  addWord(arr, value){
    value &= 0xFFFF;
    arr.push((value & 0xFF00) >> 8);
    arr.push(value & 0xFF);
  }

  getRequestCounter(){
    if (this.requestCounter > 0xFFFF) this.requestCounter = 0;
    return this.requestCounter++;
  }

  getTypeLength(item){
    if ((item.type == 'Coil') || (item.type == "DescreateInput")) return 1;
    let typeName = item.modbusDisplayType;
    if(!typeName) return 1;
    let len = typesLength[typeName];
    if(len) return len;
    return 1;
  }

  prepareRequests(cmd, tags){
    let requests = [];
    let registers = {};
    modbusTypes.forEach((item) => {
      registers[item] = [];
    });
    for (let item of tags){
      let len = this.getTypeLength(item);
      let valueWriteParts = [];
      if(cmd == 'write'){
        valueWriteParts = this.getValueWriteParts(item, len);
      }
      for(let i = 0; i < len; i++){
        if(cmd == 'read'){
          registers[item.modbusVarType].push({"tag": i.toString() + item.name, "address": item.modbusVarAddress + i});
        }else{
          registers[item.modbusVarType].push({"tag": i.toString() + item.name, "address": item.modbusVarAddress, "value": valueWriteParts[i]});
        }
      }
    }
    modbusTypes.forEach((item) => {
      requests.push(this.getRequestByType(registers, item));
    });
    return requests;
  }

  getValueWriteParts(item, len){
    //HERE
    console.log("item=", item);
    let res = [];
    let valueObj = {};
    valueObj.modbusDisplayType = item.modbusDisplayType || defaultModbusDisplayType;
    valueObj.modbusBytesOrder = item.modbusBytesOrder || defaultModbusBytesOrder;
    this.encodeValue(valueObj, item.setValue); // need to implement
    this.swapBytes(valueObj);
    for (let i = 0; i < len; i++) {
      res.push(0);
    }
    return res;
  }

  getRequestByType(registers, type){
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
        tags.push(item.tag);
        counter++;
      }else{
        let prevIndex = startIndex + counter - 1;
        if(prevIndex == item.address) tags.push(item.tag);
        if(((item.address - prevIndex) == 1) && (counter < maxReadCount)){
          requestsTags.push(tags);
          tags = [item.tag];
          counter++;
        }else if(((item.address - prevIndex) > 1) || (counter == maxReadCount)){
          requestsTags.push(tags);
          requests.push({"start": startIndex, "count": counter, "tags": requestsTags, "type": type});
          requestsTags = [];
          startIndex = item.address;
          tags = [item.tag];
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
      let value = ((item.type == 'Coil') || (item.type == 'DescreateInput')) ? this.parseDiscreateValue(i, data) : null;
      for(let j = 0; j < item.tags[i].length; j++){
        let itemName = item.tags[i][j].slice(1);
        if(value){
          this[fullDeviceName][transID].values[itemName] = value;
        }else{
          if(!buffer[itemName]){
            buffer[itemName] = {};
            let mdt = tagsObj[itemName].modbusDisplayType;
            if(mdt) buffer[itemName].modbusDisplayType = mdt;
            let mbo = tagsObj[itemName].modbusBytesOrder;
            if(mbo) buffer[itemName].modbusBytesOrder = mbo;
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
    switch (valueObj.modbusDisplayType) {
      case 'Int': case 'Long':
        return this.uniParseIntValue(valueObj, true);
      case 'UInt': case 'ULong':
        return this.uniParseIntValue(valueObj, false);
      case 'Float':
        return this.parseFloatValue(valueObj, false);
      case 'Double':
        return this.parseFloatValue(valueObj, true);
      default:
        return this.uniParseIntValue(valueObj, false);
    }
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
    let maxValue = BigInt(1);
    maxValue <<= BigInt(16 * regsCount);
    maxValue = Number(maxValue);
    return (value >= maxValue/2)?value - maxValue : value;
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

  finishParse(tags, transID){
    let fullDeviceName = this.getFullDeviceAddress(tags);
    let values = [];
    for(let tag of tags){
      if(this[fullDeviceName][transID].values){
        values.push(this[fullDeviceName][transID].values[tag.name])
      }else{
        values.push(null);
      }
    }
    delete this[fullDeviceName][transID];
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
    this.packetIdIndex = 0;
    this.packetModbusAddressIndex = 6;
    this.packetModbusFuncIndex = 7;
    this.packetModbusLenIndex = 8;
    this.packetValuesIndex = 9;
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
    return this.getByte(buffer, this.packetModbusFuncIndex);
  }

  getValues(buffer){
    let len = this.getByte(buffer, this.packetModbusLenIndex);
    if(len) return buffer.slice(this.packetValuesIndex, this.packetValuesIndex + len);
    return null;
  }
}


module.exports = CustomDriver;
