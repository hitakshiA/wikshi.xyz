export const USDC = '0.0.429274';
export const HBAR = '0.0.0';
export const ASSETS = Object.freeze({
  [USDC]: Object.freeze({asset:USDC,currency:'USDC',decimals:6}),
  [HBAR]: Object.freeze({asset:HBAR,currency:'HBAR',decimals:8}),
});
export const supportedAsset = asset => Object.hasOwn(ASSETS,asset);
