const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const pngToIco=require('png-to-ico');

(async()=>{
  const root=path.resolve(__dirname,'..');
  const svg=path.join(root,'build','app-icon.svg');
  const out=path.join(root,'build');
  fs.mkdirSync(out,{recursive:true});
  const sizes=[16,24,32,48,64,128,256];
  const pngs=[];
  for(const size of sizes){
    const file=path.join(out,'icon-'+size+'.png');
    await sharp(svg).resize(size,size).png().toFile(file);
    pngs.push(file);
  }
  const ico=await pngToIco(pngs);
  fs.writeFileSync(path.join(out,'icon.ico'),ico);
  await sharp(svg).resize(512,512).png().toFile(path.join(out,'icon-512.png'));
  console.log('App Interface Studio icons generated.');
})().catch(err=>{console.error(err);process.exit(1)});
