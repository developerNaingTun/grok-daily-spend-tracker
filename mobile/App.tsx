import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { configured, request, supabase } from './src/client';
import { categories, Category, Entry, Household, money, summarize, today, validAmount, validDate } from './src/ledger';

function Button({ title, onPress, muted = false, disabled = false }: { title: string; onPress: () => void; muted?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, muted && styles.secondary, disabled && {opacity: .45}]}><Text style={muted ? styles.secondaryText : styles.buttonText}>{title}</Text></Pressable>;
}
function Field({ label, value, onChangeText, secret = false, numeric = false }: {label:string; value:string; onChangeText:(value:string)=>void; secret?:boolean; numeric?:boolean}) {
  return <View style={{marginBottom:12}}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} style={styles.input} value={value} onChangeText={onChangeText} secureTextEntry={secret} autoCapitalize="none" keyboardType={numeric ? 'decimal-pad' : 'default'} /></View>;
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState(''), [password,setPassword] = useState(''), [name,setName] = useState('');
  const [signup,setSignup] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [household,setHousehold] = useState<Household | null>(null), [householdName,setHouseholdName] = useState('Our home'), [code,setCode] = useState('');
  const [entries,setEntries] = useState<Entry[]>([]), [month,setMonth] = useState(today().slice(0,7)), [monthInput,setMonthInput] = useState(today().slice(0,7));
  const [loaded,setLoaded] = useState(false), [refreshing,setRefreshing] = useState(false), [tab,setTab] = useState<'dashboard'|'entries'|'add'>('dashboard');
  const [amount,setAmount] = useState(''), [kind,setKind] = useState<'income'|'expense'>('expense'), [category,setCategory] = useState<Category>('Food'), [date,setDate] = useState(today()), [note,setNote] = useState(''), [editing,setEditing] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!configured) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({data,error}) => { if(error) setError(error.message); setSession(data.session); setAuthReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event,next) => { setSession(next); setAuthReady(true); });
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    const listener = AppState.addEventListener('change',state => state === 'active' ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh());
    return () => { subscription.unsubscribe(); listener.remove(); supabase.auth.stopAutoRefresh(); };
  }, []);
  const load = useCallback(async () => {
    if (!session) return;
    const version = ++generation.current;
    setRefreshing(true);
    try {
      const h = await request<Household | null>('household');
      const rows = h ? await request<Entry[]>(`entries?month=${month}`) : [];
      if (version !== generation.current) return;
      setHousehold(h); setEntries(rows); setLoaded(true); setError('');
    } catch (e) { if(version === generation.current) setError((e as Error).message); }
    finally { if(version === generation.current) setRefreshing(false); }
  }, [session?.user.id,month]);
  useEffect(() => {
    setHousehold(null); setEntries([]); setLoaded(false); setError(''); setNotice(''); setTab('dashboard');
    if (!session) return;
    void load();
    const timer = setInterval(() => void load(),30000);
    const listener = AppState.addEventListener('change',state => { if(state === 'active') void load(); });
    return () => { clearInterval(timer); listener.remove(); generation.current++; };
  }, [load]);
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function authenticate() {
    if (!email.includes('@') || password.length < 8 || (signup && !name.trim())) throw new Error('Enter your email, a password of at least 8 characters, and your name when registering.');
    if (signup) {
      const {data,error} = await supabase.auth.signUp({email:email.trim(),password,options:{data:{display_name:name.trim()}}});
      if (error) throw error;
      if (!data.session) setNotice('Check your email to confirm your account, then sign in.');
    } else { const {error} = await supabase.auth.signInWithPassword({email:email.trim(),password}); if(error) throw error; }
    setPassword('');
  }
  function resetEntry() { setEditing(null); setAmount(''); setKind('expense'); setCategory('Food'); setDate(today()); setNote(''); }
  function edit(entry: Entry) { setEditing(entry.id); setAmount(String(entry.amount)); setKind(entry.kind); setCategory(entry.category); setDate(entry.date); setNote(entry.note); setTab('add'); }
  async function saveEntry() {
    if (!validAmount(amount) || !validDate(date) || note.length > 300) throw new Error('Enter a positive amount (up to two decimal places), a valid YYYY-MM-DD date, and a note up to 300 characters.');
    await request(editing ? `entries/${editing}` : 'entries',editing ? 'PUT' : 'POST',{amount:Number(amount),kind,category,date,note});
    const savedMonth = date.slice(0,7);
    resetEntry(); setTab('entries');
    if (savedMonth !== month) {setMonth(savedMonth); setMonthInput(savedMonth);} else await load();
  }
  const totals = summarize(entries);
  const memberName = (id: string) => household?.members.find(m => m.user_id === id)?.display_name ?? 'Partner';
  return <SafeAreaView style={styles.safe}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" refreshControl={session ? <RefreshControl refreshing={refreshing} onRefresh={() => void load()} /> : undefined}>
    <Text style={styles.brand}>TOGETHER / SPEND</Text><Text style={styles.heading}>{session ? household?.name ?? 'Your shared home' : 'Money, together.'}</Text>
    <Text style={styles.subtitle}>{session ? 'Two people. One clear picture.' : 'A little clarity for your everyday life.'}</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{!!notice && <Text style={styles.notice}>{notice}</Text>}
    {!configured ? <View style={styles.card}><Text style={styles.title}>Connect your project</Text><Text>Set the three EXPO_PUBLIC variables in mobile/.env, then restart Expo. See README.md for Supabase and API setup.</Text></View> : !authReady ? <ActivityIndicator /> : !session ? <View style={styles.card}>
      <Text style={styles.title}>{signup ? 'Create your account' : 'Welcome back'}</Text>
      {signup && <Field label="Your name" value={name} onChangeText={setName} />}
      <Field label="Email" value={email} onChangeText={setEmail} /><Field label="Password" value={password} onChangeText={setPassword} secret />
      <Button title={busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'} disabled={busy} onPress={() => void act(authenticate)} />
      <Button title={signup ? 'Already registered? Sign in' : 'New here? Create an account'} muted disabled={busy} onPress={() => {setSignup(!signup);setError('');}} />
    </View> : <>
      <View style={styles.row}><Text style={styles.small}>{session.user.email}</Text><Button title="Sign out" muted disabled={busy} onPress={() => void act(async () => {const {error} = await supabase.auth.signOut(); if(error) throw error;})} /></View>
      {!loaded ? <View style={styles.card}><Text>{error ? 'Could not load your household.' : 'Loading your household…'}</Text><Button title="Retry" onPress={() => void load()} /></View> : !household ? <View style={styles.card}>
        <Text style={styles.title}>Bring your household together</Text><Text style={styles.subtitle}>One partner creates a home. The other joins with the invitation code.</Text>
        <Field label="Household name" value={householdName} onChangeText={setHouseholdName} /><Button title="Create household" disabled={busy} onPress={() => void act(async () => { await request('household','POST',{name:householdName}); await load(); })} />
        <Text style={styles.divider}>OR JOIN YOUR PARTNER</Text><Field label="Invitation code" value={code} onChangeText={setCode} /><Button title="Join household" muted disabled={busy} onPress={() => void act(async () => {await request('household/join','POST',{code});await load();})} />
      </View> : <>
        {household.members.length < 2 && <View style={styles.card}><Text style={styles.label}>Share this code privately with your partner</Text><Text selectable style={styles.code}>{household.invite_code}</Text></View>}
        <View style={styles.row}>{(['dashboard','entries','add'] as const).map(t => <Button key={t} title={t === 'add' ? '+ Entry' : t === 'entries' ? 'Activity' : 'Overview'} muted={tab !== t} onPress={() => setTab(t)} />)}</View>
        {tab !== 'add' && <View style={styles.card}><Field label="Month (YYYY-MM)" value={monthInput} onChangeText={setMonthInput} /><Button title="Show month" muted onPress={() => {if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput) || !validDate(monthInput+'-01')) {setError('Use YYYY-MM, for example 2026-11.');return;}setMonth(monthInput);}} /><Text style={styles.small}>Pull to refresh · updates every 30 seconds</Text></View>}
        {tab === 'dashboard' && <>
          <View style={[styles.card,styles.balance]}><Text style={styles.balanceLabel}>MONTHLY BALANCE · {month}</Text><Text style={styles.balanceNumber}>{money(totals.balance)}</Text><Text style={styles.balanceLabel}>Income minus expenses</Text></View>
          <View style={styles.card}><View style={styles.row}><View><Text style={styles.label}>INCOME</Text><Text style={styles.income}>{money(totals.income)}</Text></View><View><Text style={styles.label}>EXPENSES</Text><Text style={styles.title}>{money(totals.expense)}</Text></View></View></View>
          <View style={styles.card}><Text style={styles.title}>Where it went</Text>{totals.byCategory.length === 0 && <Text style={styles.subtitle}>Add your first expense to see a breakdown.</Text>}{totals.byCategory.map(c => <View key={c.category} style={{marginVertical:8}}><View style={styles.row}><Text>{c.category}</Text><Text>{money(c.amount)}</Text></View><View style={styles.track}><View style={[styles.bar,{width:`${totals.expense ? c.amount/totals.expense*100 : 0}%`}]} /></View></View>)}</View>
          <View style={styles.card}><Text style={styles.title}>Each of you</Text>{household.members.map(m => {const v=totals.byPerson[m.user_id] ?? {income:0,expense:0}; return <View key={m.user_id} style={{marginVertical:10}}><Text style={styles.person}>{m.display_name}{m.user_id===session.user.id ? ' (you)' : ''}</Text><Text style={styles.subtitle}>Income {money(v.income)} · Spent {money(v.expense)}</Text></View>;})}</View>
        </>}
        {tab === 'entries' && <View style={styles.card}><Text style={styles.title}>Activity · {month}</Text>{entries.length === 0 && <Text style={styles.subtitle}>No entries this month.</Text>}{entries.map(e => <View key={e.id} style={styles.entry}><View style={styles.row}><Text style={styles.person}>{e.category}</Text><Text style={e.kind === 'income' ? styles.income : styles.person}>{e.kind === 'income' ? '+' : '−'}{money(Number(e.amount))}</Text></View><Text style={styles.small}>{e.date} · {memberName(e.owner_id)}</Text>{!!e.note && <Text style={styles.subtitle}>{e.note}</Text>}{e.owner_id === session.user.id && <View style={styles.row}><Button title="Edit" muted disabled={busy} onPress={() => edit(e)} /><Button title="Delete" muted disabled={busy} onPress={() => Alert.alert('Delete entry?','This will remove this entry from your shared totals.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:() => void act(async () => {await request(`entries/${e.id}`,'DELETE');await load();})}])} /></View>}</View>)}</View>}
        {tab === 'add' && <View style={styles.card}><Text style={styles.title}>{editing ? 'Edit your entry' : 'A new entry'}</Text><View style={styles.row}><Button title="Expense" muted={kind!=='expense'} onPress={() => {setKind('expense');setCategory('Food');}} /><Button title="Income" muted={kind!=='income'} onPress={() => {setKind('income');setCategory('Salary');}} /></View><Field label="Amount (MMK)" value={amount} onChangeText={setAmount} numeric /><Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} /><Text style={styles.label}>Category</Text><View style={styles.chips}>{categories.map(c => <Pressable accessibilityRole="button" accessibilityState={{selected:category===c}} key={c} style={[styles.chip,category===c && styles.selectedChip]} onPress={() => setCategory(c)}><Text style={category===c ? {color:'white'} : undefined}>{c}</Text></Pressable>)}</View><Field label="Note (optional)" value={note} onChangeText={setNote} /><Button title={busy ? 'Saving…' : 'Save entry'} disabled={busy} onPress={() => void act(saveEntry)} /><Button title="Cancel" muted disabled={busy} onPress={() => {resetEntry();setTab('entries');}} /></View>}
      </>}
    </>}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#F5F3EC'},page:{padding:22,paddingTop:42,paddingBottom:60,maxWidth:680,width:'100%',alignSelf:'center'},brand:{fontSize:11,fontWeight:'800',letterSpacing:3,color:'#486458',marginBottom:16},heading:{fontSize:32,fontWeight:'700',color:'#193A2E'},subtitle:{color:'#66726B',lineHeight:22,marginVertical:8},card:{backgroundColor:'#FFFDF8',borderRadius:20,padding:20,marginVertical:10,borderWidth:1,borderColor:'#E6E6DC'},title:{fontSize:20,fontWeight:'600',color:'#193A2E',marginBottom:12},label:{fontSize:12,color:'#637368',marginBottom:8,fontWeight:'600'},input:{borderWidth:1,borderColor:'#D6DDD4',borderRadius:10,padding:13,fontSize:16,color:'#193A2E',backgroundColor:'#fff'},button:{backgroundColor:'#244E3C',borderRadius:10,paddingVertical:13,paddingHorizontal:16,alignItems:'center',marginVertical:5},buttonText:{color:'#fff',fontWeight:'600'},secondary:{backgroundColor:'#E9EDE4'},secondaryText:{color:'#244E3C',fontWeight:'600'},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8},small:{fontSize:12,color:'#69766C',marginVertical:6},divider:{fontSize:11,letterSpacing:2,color:'#788276',textAlign:'center',marginVertical:24},code:{fontSize:16,color:'#244E3C',fontWeight:'600'},balance:{backgroundColor:'#244E3C',paddingVertical:30},balanceLabel:{color:'#C9D8C5',fontSize:11,letterSpacing:1},balanceNumber:{color:'#fff',fontSize:30,fontWeight:'600',marginVertical:14},income:{fontSize:18,fontWeight:'600',color:'#307353'},track:{height:6,backgroundColor:'#E9EDE4',borderRadius:3,marginTop:9},bar:{height:6,backgroundColor:'#98AD68',borderRadius:3},person:{fontSize:16,fontWeight:'600',color:'#244E3C'},entry:{borderTopWidth:1,borderTopColor:'#E9EDE4',paddingTop:16,marginTop:16},chips:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:20},chip:{borderRadius:20,padding:10,backgroundColor:'#E9EDE4'},selectedChip:{backgroundColor:'#244E3C'},error:{color:'#9D312B',backgroundColor:'#FBE8E3',padding:14,borderRadius:10,marginVertical:10},notice:{color:'#244E3C',padding:14,backgroundColor:'#E0ECD9',borderRadius:10,marginVertical:10}
});
