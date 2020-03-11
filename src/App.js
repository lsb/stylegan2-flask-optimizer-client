import React from 'react';
import ImageUploader from 'react-images-upload';
import './App.css';
import {decode as u64toArrayBuffer, encode as arrayBufferToU64} from 'base64url-arraybuffer';
const browserImageSize = require('browser-image-size');
const downscale = require('downscale');

const ENDPOINT = "https://gpu.leebutterman.com";
const ENDPOINT_ALIGNFACES = (u64rawfaces) => `${ENDPOINT}/alignfaces?u64rawfaces=${u64rawfaces}`;
const ENDPOINT_RENDER9000 = (u64latents) => `${ENDPOINT}/render9000?u64latents=${u64latents}`;
const ENDPOINT_OPTIMIZE = (u64reference, u64latents) => `${ENDPOINT}/optimize?lr=1&decayrate=0.95&iterations=100&u64reference=${u64reference}&u64latents=${u64latents}`;

const dataURLB64ToServerU64 = (b64) => b64.split(/,/)[1].replace(/[+]/g,"-").replace(/[/]/g,"_");
const serverU64ToDataURLB64 = (u64) => `data:image/webp;base64,${u64.replace(/[-]/g,'+').replace(/[_]/g,'/')}`;

const zeroFaceU64 = Array.from({length: 18 * 512 * 4 * 4 / 3}, () => "A").join("");

const saxpy = (a,x,y) => Float32Array.from({length: x.length}, (v,k) => a * x[k] + y[k]);

const u64ToFloats = (u64) => new Float32Array(u64toArrayBuffer(u64));
const floatsToU64 = (f32) => arrayBufferToU64(f32.buffer);

const extendLatents = (faceToMorph, sliderIntensity, dropdownMorphChooser, availableFaces, distanceInMorph) => floatsToU64(saxpy(distanceInMorph * (sliderIntensity / 10), getDirection(dropdownMorphChooser, availableFaces), u64ToFloats(faceToMorph)));

const getDirection = (dropdownMorphChooser, availableFaces) => {
  const [src, dst] = dropdownMorphChooser.split(' ').map(f => availableFaces.get(f));
  return saxpy(-1, u64ToFloats(src), u64ToFloats(dst));
}

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {imageDataURL: null, u64AlignedFaces: null, u64Latents: null, facemathslider: 3, facemathdropdown: "brian trixie2"};
    const faceURLs = new Map([
      ["brian", "./brian-firkus3_01.latents"],
      ["trixie1", "./trixie-mattel1_01.latents"],
      ["trixie2", "./trixie-mattel-2_01.latents"],
      ["lsb1", "./lsb1_01.latents"],
      ["lsb2", "./lsb2_01.latents"],
      ["lsb3", "./lsb3_01.latents"],
      ["lsb4", "./lsb4_01.latents"],
      ["lsb5", "./lsb5_01.latents"],
    ]);
    this.loadFaces(faceURLs);
  }
  async loadFaces(faceURLs) {
    const err = (r) => this.setState({error: `loadFaces error ${r.status}`});
    const faces = new Map([["src", zeroFaceU64],["dst", zeroFaceU64]]);
    for(let [faceKey, facePath] of faceURLs) {
      for await (const line of fetchNDUTF8Lines(facePath, err)) {
        faces.set(faceKey, line);
      }
    }
    this.setState({faces});
    console.log(faces)

  }
  async optimize(prefix="") {
    if(this.state[`${prefix}optimizeLatch`] === true) {
      this.setState({[`${prefix}optimizeAgain`]: true});
      return;
    }
    console.log(`optimizing ${prefix}`);
    this.state[`${prefix}optimizeLatch`] = true; // avoid batching locking/latching with setState
    this.state[`${prefix}optimizeAgain`] = false;
    this.setState({[`${prefix}lastOptimize`]: Date.now()})
    const {[`${prefix}u64AlignedFaces`]: u64AlignedFaces, [`${prefix}u64Latents`]: u64Latents} = this.state;
    if(u64Latents === null || u64AlignedFaces === null || u64AlignedFaces.length === 0) return;
    const url = ENDPOINT_OPTIMIZE(u64AlignedFaces[0], u64Latents);
    this.setState({error: null});
    const err = (r) => this.setState({error: `OPTIMIZE error ${r.status}`});
    try {
      for await (const line of fetchNDUTF8Lines(url, err)) {
        this.setState({[`${prefix}u64Latents`]: line});
        this.state.faces.set(prefix, line);
      }
    } catch (e) {
      this.setState({error: `OPTIMIZE error run ${e}`});
    }
    this.state[`${prefix}optimizeLatch`] = false;
    this.setState({[`${prefix}lastOptimize`]: Date.now()})
    if(this.state[`${prefix}optimizeAgain`] === true) this.optimize(prefix);
  }
  async onDrop(pictureFiles, [rawImageDataURL], prefix="") {
    const {width, height} = await browserImageSize(rawImageDataURL);
    const imageDataURL = await ((width > height) ? downscale(rawImageDataURL, 0, 1024, {imageType: "jpeg", "quality": 0.7}) : downscale(rawImageDataURL, 1024, 0, {imageType: "jpeg", "quality": 0.7}));
    this.setState({[`${prefix}imageDataURL`]: imageDataURL});
    if(!imageDataURL || !imageDataURL.length || imageDataURL.length === 0) {
      this.setState({[`${prefix}u64AlignedFaces`]: null, [`${prefix}u64Latents`]: null});
    } else {
      const url = ENDPOINT_ALIGNFACES(dataURLB64ToServerU64(imageDataURL));
      const err = (response) => this.setState({error: `ALIGNFACES error ${response.status}`});
      const u64AlignedFaces = [];
      this.setState({[`${prefix}u64AlignedFaces`]: u64AlignedFaces, [`${prefix}u64Latents`]: zeroFaceU64});
      this.state.faces.set(prefix, zeroFaceU64);
      for await (const line of fetchNDUTF8Lines(url, err)) {
        u64AlignedFaces.push(line);
        this.setState({[`${prefix}alignedFacesCount`]: u64AlignedFaces.length});
      }
      if(u64AlignedFaces.length > 0) this.optimize(prefix);
    }
  }
  useFacelessUpload() {
    this.setState({u64AlignedFaces: [dataURLB64ToServerU64(this.state.imageDataURL)]});
  }
  render() {
    return (
      <div className="App">
        <h1>Face-math selfie makeover</h1>
        <div className="error">
          {this.state.error}
        </div>
        <div className="picker">
          <ImageUploader withIcon={true} buttonText="Let me take a selfie" onChange={(f,u) => this.onDrop(f,u)} singleImage={true} />
        </div>
        <div className="facemath">
          {this.state.facemathdropdown !== "src dst" ? (<img src={ENDPOINT_RENDER9000(!this.state.faces ? zeroFaceU64 : this.state.faces.get(String(this.state.facemathdropdown).split(" ")[0], zeroFaceU64))} />) : (<div className="iuib">
            {!this.state.srcu64Latents ? "encoded faces show up here" : (<img src={ENDPOINT_RENDER9000(this.state.srcu64Latents)} title="enhance!" onClick={() => this.optimize("src")} />) }
            <ImageUploader withIcon={true} buttonText="starting point" onChange={(f,u) => this.onDrop(f,u,"src")} singleImage={true} />
            </div>)}
          <div className="iuib">
          <input type="range" min={0} max={11} value={this.state.facemathslider} onChange={e => this.setState({facemathslider: e.target.value * 1})} /> ± {this.state.facemathslider * 10}%<br/>
          <select value={this.state.facemathdropdown} onChange={e => this.setState({facemathdropdown: e.target.value})}>
            <option value="brian trixie2">± Trixie Mattel 2</option>
            <option value="brian trixie1">± Trixie Mattel 1</option>
            <option value="lsb4 lsb5">± Glasses</option>
            <option value="src dst">± choose your own!</option>
          </select>
          </div>
          {this.state.facemathdropdown !== "src dst" ? (<img src={ENDPOINT_RENDER9000(!this.state.faces ? zeroFaceU64 : this.state.faces.get(String(this.state.facemathdropdown).split(" ")[1], zeroFaceU64))} />) : (<div className="iuib">
            {!this.state.dstu64Latents ? "encoded faces show up here" : (<img src={ENDPOINT_RENDER9000(this.state.dstu64Latents)} title="enhance!" onClick={() => this.optimize("dst")} />) }
            <ImageUploader withIcon={true} buttonText="ending point" onChange={(f,u) => this.onDrop(f,u,"dst")} singleImage={true} />
            </div>)}
          <hr/>
          {this.state.u64Latents === null ? "" : [-1,-0.5,-0.25,0,0.25,0.5,1].map(d => (<img src={ENDPOINT_RENDER9000(extendLatents(this.state.u64Latents, this.state.facemathslider, this.state.facemathdropdown, this.state.faces, d))} />))}
        </div>
        <div>
          &nbsp; {this.state.optimizeLatch ? "⚡" : ""} {this.state.optimizeAgain ? "𝄎" : ""}
        </div>
        <div className="latentface">
          {this.state.u64Latents === null ? "encoded faces show up here" : (<img src={ENDPOINT_RENDER9000(this.state.u64Latents)} onClick={() => this.optimize()} />) }
        </div>
        <div className="alignedfaces">
          {this.state.u64AlignedFaces === null
            ? (this.state.imageDataURL === null ? (<i>aligned faces show up here</i>) : (<i>aligning...</i>))
            : (this.state.u64AlignedFaces.length === 0 ? (<button onClick={() => this.useFacelessUpload()}>Use this even though it doesn't look like it has a face</button>) : this.state.u64AlignedFaces.map(u64f => (<img src={serverU64ToDataURLB64(u64f)} />)))}
        </div>
      </div>
    )
  }
}


async function* fetchNDUTF8Lines(url, err) {
  const response = await fetch(url);
  if(!response.ok) {
    err(response)
  } else {
    const uint8Stream = streamAsyncIterator(response.body);
    const stringStream = uint8b64ChunksToStrings(uint8Stream);
    const lineStream = stringChunksToLines(stringStream);
    for await (const line of lineStream) {
      yield line;
    }
  }
}
async function* stringChunksToLines(chunks) {
  let previous = "";

  for await (const chunk of chunks) {
    previous += chunk;
    let eolIndex;

    while ((eolIndex = previous.indexOf("\n")) >= 0) {
      // this line includes the EOL
      const line = previous.slice(0, eolIndex + 1);
      yield line;
      previous = previous.slice(eolIndex + 1);
    }
  }

  if (previous.length > 0) {
    yield previous;
  }
}
async function* uint8b64ChunksToStrings(chunks) {
  for await (const chunk of chunks) {
    yield (new TextDecoder("utf-8").decode(chunk));
  }
}
async function* streamAsyncIterator(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export default App;
