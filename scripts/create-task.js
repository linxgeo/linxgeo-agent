// 创建发布任务（TC-14 用），内容取自 argv 或内置默认
const jwt = require('fs').readFileSync('/tmp/jwt.txt', 'utf8').trim();
const content = [
  '入冬后气温下降，门窗的密封性能直接关系到室内保温效果与采暖能耗。以下是五个实用的保养建议。',
  '一、检查密封条。密封条老化是漏风的首要原因，建议每季度用手按压检查弹性，若出现发硬、开裂或脱落，应及时更换同规格胶条。擦拭时用软布蘸清水，避免使用强酸强碱清洁剂，以免加速橡胶老化。',
  '二、清理轨道灰尘。推拉门窗的下轨道容易积存沙粒与毛发，长期不清理会磨损滑轮。可用吸尘器配合软毛刷清理，再用微湿抹布擦净，最后擦干避免积水生锈。',
  '三、润滑五金件。合页、执手、滑轮在使用一段时间后会出现干涩异响，可少量涂抹专用润滑脂或硅油，切忌使用食用油，因为食用油容易粘灰并氧化变黏。',
  '四、调整关闭缝隙。若发现关窗后仍能感觉到明显气流，多因合页松动导致窗扇下沉，可请专业人员调整合页或锁点，必要时更换密封毛条。',
  '五、减少剧烈开关。猛力推拉会加速五金件磨损与型材变形，日常开关动作轻缓，遇到卡滞先排查轨道异物，不要强行用力。',
  '做好以上五点，不仅能提升冬季室内舒适度，还能减少采暖能耗，延长门窗使用寿命。',
].join('\n');

fetch('https://linxgeo.com/api/agent/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
  body: JSON.stringify({
    agent_id: 'ag_b3104d87a1f38a045c43',
    platform: 'toutiao',
    title: '冬季门窗保养的五个实用建议',
    content,
  }),
}).then((r) => r.json()).then((d) => console.log('建任务:', JSON.stringify(d)))
  .catch((e) => { console.log('ERR: ' + e.message); process.exit(1); });
