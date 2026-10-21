const konami=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];

/** Unlock a playback option only; simulation inputs and computed events stay unchanged. */
export function installPlaybackShortcut({document,speed,onUnlock=()=>{}}){
  let keys=[];
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.ctrlKey||event.altKey||event.metaKey||
      event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')){
      keys=[];return;
    }
    if(event.repeat)return;
    const key=event.key.length===1?event.key.toLowerCase():event.key;
    keys.push(key);
    // Preserve overlapping prefixes when an extra arrow precedes the command.
    while(keys.length&&!keys.every((value,index)=>value===konami[index]))keys.shift();
    if(keys.length!==konami.length)return;
    keys=[];
    if([...speed.options].some(option=>option.value==='10'))return;
    const option=document.createElement('option');option.value='10';option.textContent='10倍';speed.append(option);
    onUnlock();
  });
}
