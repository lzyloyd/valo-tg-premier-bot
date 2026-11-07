import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { config } from './config.js';
const context = new AsyncLocalStorage();
const ovtRoster = [
  // Starters
  { riotId: 'Space Kururugi#mench', sheetLabels: ['Space#flick', 'Space#mench'] }, // @Qu1ly
  { riotId: 'ジ lzyloyd#pivo', sheetLabels: [] }, // @lzyloyd
  { riotId: 'AHotNik#2410', sheetLabels: ['toshir0000#6666'] }, // @toshir0000
  { riotId: 'Ax1oM#6525', sheetLabels: [] }, // @KitKatFN
  { riotId: 'Ice blue#bonr', sheetLabels: ['MILITANTUM#bonr'] }, // @Bonrik1
  // Substitutes, by priority
  { riotId: 'speak with dead#amen', sheetLabels: [] }, // @deadqq
  { riotId: 'Mench Lamperouge#space', sheetLabels: ['Mench#space'] }, // @Men4ikcs
];
export const statsTeams = [
 {id:'ovt',autoReports:true,name:'Overthinkers',roster:ovtRoster,spreadsheetId:config.statsSpreadsheetId,chatId:String(config.statsChatId || config.telegramChatId),commandChatIds:[config.telegramChatId,config.statsChatId,config.scheduleChatId].filter(Boolean).map(String),threadId:config.statsThreadId,splitLabel:config.currentSplitLabel,overallTab:'Статистика за V26A5',premierRosterId:config.premierRosterId,reportChatId:config.telegramChatId,reportThreadId:config.telegramMessageThreadId,statePath:config.statePath},
 {id:'clarity',autoReports:process.env.CLARITY_AUTO_REPORTS === 'true',name:'Clarity',roster:[
  {riotId:'khhhaneul#witch',sheetLabels:[]},
  {riotId:'lizka shmakadyn#sasha',sheetLabels:[]},
  {riotId:'Mania#uma',sheetLabels:[]},
  {riotId:'solace#0一0',sheetLabels:[]},
  {riotId:'arare#yanni',sheetLabels:[]},
 ],spreadsheetId:process.env.CLARITY_STATS_SPREADSHEET_ID || '1VTgAUrtjwFb61pfdNo6cctoEk-drL9aA5NuZvD-fUdc',chatId:'-1004419192416',commandChatIds:['-1004419192416'],threadId:process.env.CLARITY_STATS_THREAD_ID || '763',splitLabel:process.env.CLARITY_SPLIT_LABEL || 'V26A6',overallTab:'Статистика за V26A6',premierRosterId:'95ffb4b9-dadb-49f0-b326-33018e66e072',reportChatId:'-1004419192416',reportThreadId:process.env.CLARITY_STATS_THREAD_ID || '763',get statePath(){return path.join(config.dataDir,'state-clarity.json');}}
];
export function currentStatsTeam() {return context.getStore() || statsTeams[0];}
export function withStatsTeam(team,work) {return context.run(team,work);}
export function statsTeamForChat(chatId) {return statsTeams.find(team=>team.commandChatIds.includes(String(chatId))) || null;}
export function overallPremierTab() {return currentStatsTeam().overallTab;}
