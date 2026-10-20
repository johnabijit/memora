import test from 'node:test'
import assert from 'node:assert/strict'
import {startPhoneLink,confirmPhoneLink,maskedPhone,phoneLinkMessage} from '../client/phone-link.js'
test('adding mobile changes existing signed-in identity, never signs up a new one',async()=>{
 const calls=[]
 const auth={
   getUser:async()=>({data:{user:{id:'existing-google-user',phone:''}},error:null}),
   updateUser:async changes=>{calls.push(changes);return {data:{},error:null}},
   signInWithOtp:async()=>{throw Error('Must never create another account')}
 }
 assert.equal(await startPhoneLink(auth,{phone:'+91 98765 43210',expectedUserId:'existing-google-user'}),'+919876543210')
 assert.deepEqual(calls,[{phone:'+919876543210'}])
})
test('verification uses phone_change and retains the same account and stored memories',async()=>{
 const calls=[]
 let updated=false
 const auth={
   getUser:async()=>({data:{user:{id:'existing-google-user',phone:updated?'+919876543210':''}},error:null}),
   verifyOtp:async x=>{calls.push(x);updated=true;return {data:{},error:null}}
 }
 const user=await confirmPhoneLink(auth,{phone:'+919876543210',token:'123456',expectedUserId:'existing-google-user'})
 assert.equal(user.id,'existing-google-user')
 assert.deepEqual(calls,[{phone:'+919876543210',token:'123456',type:'phone_change'}])
})
test('refuses to continue when identity changes mid-verification',async()=>{
 let calls=0
 const auth={
   getUser:async()=>{calls++;return {data:{user:{id:calls===1?'original':'other-account',phone:'+919876543210'}},error:null}},
   verifyOtp:async()=>({data:{},error:null})
 }
 await assert.rejects(()=>confirmPhoneLink(auth,{phone:'+919876543210',token:'123456',expectedUserId:'original'}),/identity/)
})
test('requires signed-in account and redacts phone in profile',async()=>{
 await assert.rejects(()=>startPhoneLink({},{phone:'+919876543210'}),/Sign in/)
 assert.equal(maskedPhone('+919876543210'),'+91 •••• 210')
 assert.match(phoneLinkMessage({message:'duplicate key violates unique constraint'}),/another account/)
})
