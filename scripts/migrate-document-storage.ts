import {createHash} from 'node:crypto';
import {LocalDocumentStorage,S3DocumentStorage} from '../src/lib/document-storage';
import {prisma} from '../src/lib/prisma';

async function main(){
  if(process.env.STORAGE_BACKEND!=='s3')throw new Error('Set STORAGE_BACKEND=s3 and configure the destination bucket.');
  const removeSource=process.argv.includes('--delete-source');
  const source=new LocalDocumentStorage(),destination=new S3DocumentStorage();
  const rows=await prisma.document.findMany({where:{file_ref:{not:null},source:'uploaded',OR:[{storage_provider:null},{storage_provider:'local'}]},select:{id:true,file_ref:true,checksum:true}});
  let migrated=0;
  for(const row of rows){
    const bytes=await source.get(row.file_ref!);const sha256=createHash('sha256').update(bytes).digest('hex');
    if(row.checksum&&row.checksum!==sha256)throw new Error(`Checksum mismatch for document ${row.id}; migration stopped.`);
    const object=await destination.put({bytes,contentType:'application/octet-stream',sha256});
    const verify=await destination.metadata(object.objectKey);if(verify.sizeBytes!==bytes.length)throw new Error(`Destination verification failed for document ${row.id}.`);
    await prisma.document.update({where:{id:row.id},data:{file_ref:object.objectKey,storage_provider:'s3',storage_version_id:object.versionId,checksum:sha256}});
    if(removeSource)await source.delete(row.file_ref!);migrated++;
  }
  console.log(JSON.stringify({eligible:rows.length,migrated,source_deleted:removeSource}));
}
main().finally(()=>prisma.$disconnect());
