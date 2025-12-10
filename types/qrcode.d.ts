declare module 'qrcode' {
  // qrcode 没有自带类型，这里以 any 兜底满足 TS 编译
  const qrcode: any;
  export default qrcode;
}
