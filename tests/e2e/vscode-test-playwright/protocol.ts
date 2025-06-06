export type MessageRequestDataMap = {
  invokeMethod: {
    objectId?: number;
    fn: string;
    params: any;
    returnHandle?: boolean;
  };
  release: {
    objectId?: number;
    dispose?: boolean;
  };
  registerEvent: {
    objectId?: number;
  };
  unregisterEvent: {
    objectId?: number;
  };
};

export type VSCodeHandleObject = {
  __vscodeHandle: true | "eventEmitter";
  objectId: number;
};

export type MessageResponseDataMap = {
  invokeMethod: {
    error?: any;
    result?: VSCodeHandleObject | any;
  };
  release: void;
  registerEvent: void;
  unregisterEvent: void;
  dispatchEvent: {
    objectId?: number;
    event: any;
  };
};

type Message<Map extends Object, K extends keyof Map = keyof Map> = {
  op: K;
  id?: number;
  data: Map[K];
};

export type RequestMessage = Message<MessageRequestDataMap>;
export type ResponseMessage = Message<MessageResponseDataMap>;
