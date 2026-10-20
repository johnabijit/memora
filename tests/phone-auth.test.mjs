import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizePhoneNumber,normalizePhoneOtp,requestPhoneOtp,confirmPhoneOtp,resendPhoneOtp,phoneAuthError} from '../client/phone-auth.js'

test('international numbers are normalized and validated',()=>{
  assert.equal(normalizePhoneNumber(' +91 (98765) 43210 '),'+919876543210')
  assert.equal(normalizePhoneNumber('+1 415-555-0100'),'+14155550100')
  for(const invalid of ['9876543210','+0 9876543210','+1-22','+91 123456789012345678', '<script>']) {
    assert.throws(()=>normalizePhoneNumber(invalid))
  }
})

test('SMS OTP is numeric, short lived input with no stored token',()=>{
  assert.equal(normalizePhoneOtp(' 123456 '),'123456')
  assert.throws(()=>normalizePhoneOtp('12345'))
  assert.throws(()=>normalizePhoneOtp('12AB56'))
  assert.throws(()=>normalizePhoneOtp('123456789'))
})

test('signup requests may create a user; login requests must not', async()=>{
  const calls=[]
  const auth={signInWithOtp:async payload=>{calls.push(payload);return {error:null}}}
  await requestPhoneOtp(auth,{phone:'+91 9876543210',createAccount:true,displayName:'  Example User  '})
  await requestPhoneOtp(auth,{phone:'+91 9876543210',createAccount:false})
  assert.equal(calls[0].options.shouldCreateUser,true)
  assert.equal(calls[0].options.channel,'sms')
  assert.deepEqual(calls[0].options.data,{display_name:'Example User'})
  assert.equal(calls[1].options.shouldCreateUser,false)
  assert.equal(calls[1].options.data,undefined)
})

test('SMS OTP confirmation requires a real session and resends through Supabase',async()=>{
  const calls=[]
  const auth={
    verifyOtp:async payload=>{calls.push(payload);return {data:{session:{user:{id:'abc'}}},error:null}},
    resend:async payload=>{calls.push(payload);return {error:null}}
  }
  const signedIn=await confirmPhoneOtp(auth,{phone:'+91 9876543210',code:'123456'})
  assert.equal(signedIn.session.user.id,'abc')
  await resendPhoneOtp(auth,{phone:'+91 9876543210'})
  assert.deepEqual(calls[0],{phone:'+919876543210',token:'123456',type:'sms'})
  assert.deepEqual(calls[1],{phone:'+919876543210',type:'sms'})
})

test('SMS provider errors are explained without exposing raw internal details',()=>{
  assert.match(phoneAuthError(new Error('SMS provider not configured')),/not enabled/)
  assert.match(phoneAuthError(new Error('request rate limit exceeded')),/Too many/)
  assert.match(phoneAuthError(new Error('Token is invalid')),/invalid or expired/)
})
