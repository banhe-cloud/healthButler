const app = getApp();
const {
  login: requestLogin,
  getDailyStats,
  getUserProfile,
} = require('../../utils/request');

function barPercent(cur, tgt) {
  if (tgt == null || tgt <= 0) return 0;
  return Math.min(100, Math.round((cur / tgt) * 100));
}

function defaultMacroTargets(tc) {
  const cal = tc > 0 ? tc : 1800;
  return {
    cal,
    protein: 60,
    carbs: 200,
    fat: 60,
    fiber: 25,
  };
}

/** 与档案一致；未建档用默认比例 */
function macroTargetsFromServerProfile(profile, tcFallback) {
  if (!profile || !profile.dailyCalories) {
    return defaultMacroTargets(tcFallback);
  }
  return {
    cal: profile.dailyCalories,
    protein: profile.proteinG ?? 60,
    carbs: profile.carbsG ?? 200,
    fat: profile.fatG ?? 60,
    fiber: profile.fiberMinG ?? 25,
  };
}

function buildNutritionMetrics(agg, targets) {
  const t = targets;
  const r1 = (n) => Math.round(n * 10) / 10;
  return [
    {
      key: 'cal',
      label: '热量',
      current: Math.round(agg.totalCal),
      target: Math.round(t.cal),
      unit: 'kcal',
      barPercent: barPercent(agg.totalCal, t.cal),
    },
    {
      key: 'protein',
      label: '蛋白质',
      current: r1(agg.totalP),
      target: r1(t.protein),
      unit: 'g',
      barPercent: barPercent(agg.totalP, t.protein),
    },
    {
      key: 'carbs',
      label: '碳水',
      current: r1(agg.totalC),
      target: r1(t.carbs),
      unit: 'g',
      barPercent: barPercent(agg.totalC, t.carbs),
    },
    {
      key: 'fat',
      label: '脂肪',
      current: r1(agg.totalF),
      target: r1(t.fat),
      unit: 'g',
      barPercent: barPercent(agg.totalF, t.fat),
    },
    {
      key: 'fiber',
      label: '膳食纤维',
      current: r1(agg.totalFi),
      target: r1(t.fiber),
      unit: 'g',
      barPercent: barPercent(agg.totalFi, t.fiber),
    },
  ];
}

/** 档案展示与个性标签（基于目标 + BMI 等） */
function flattenProfileDisplay(up) {
  if (!up || !up.hasProfile || !up.profile) {
    return {
      hasHealthProfile: false,
      profileTagEmoji: '',
      profileTagText: '',
      profileLine1: '',
      profileLine2: '',
    };
  }
  const p = up.profile;
  const gender = p.gender === 'male' ? '男' : '女';
  const goalMap = {
    fat_loss: '减脂',
    maintain: '维持',
    muscle: '增肌',
  };
  const goalLabel = goalMap[p.goal] || '健康';
  const tagEmoji =
    p.goal === 'muscle' ? '💪' : p.goal === 'maintain' ? '⚖️' : '🎯';
  const bmiCat = p.bmiCategory || '';
  const profileTagText = bmiCat
    ? `${goalLabel} · ${bmiCat}`
    : `${goalLabel} · 营养管理`;
  const agePart = p.age != null && p.age > 0 ? ` · ${p.age}岁` : '';
  const profileLine1 = `${gender} · ${p.heightCm}cm · ${p.weightKg}kg${agePart}`;
  const bmiNum =
    typeof p.bmi === 'number' ? p.bmi : parseFloat(String(p.bmi || ''));
  const profileLine2 =
    p.bmi != null && !Number.isNaN(bmiNum)
      ? `BMI ${bmiNum.toFixed(1)}${bmiCat ? ` · ${bmiCat}` : ''}`
      : '';
  return {
    hasHealthProfile: true,
    profileTagEmoji: tagEmoji,
    profileTagText,
    profileLine1,
    profileLine2,
  };
}

function formatMealList(meals) {
  return (meals || []).map((m, i) => {
    const name = m.foodName || '未命名食物';
    const qty = (m.quantity || '').trim();
    return {
      mealId: m.mealId || `meal-${i}`,
      mealType: m.mealType || '餐次',
      foodName: name,
      quantity: qty,
      calories: Math.round(m.calories || 0),
      /** 单行展示：食物 · 分量 */
      displayLine: qty ? `${name} · ${qty}` : name,
    };
  });
}

/** 按餐次类型汇总展示：如「午饭×2、晚饭×1」，不臆测为「三餐」 */
function describeMealSlots(meals) {
  const order = ['早饭', '午饭', '下午茶', '晚饭', '夜宵', '未标注'];
  const c = {};
  meals.forEach((m) => {
    const t = m.mealType || '未标注';
    c[t] = (c[t] || 0) + 1;
  });
  const parts = [];
  order.forEach((t) => {
    if (c[t]) parts.push(c[t] > 1 ? `${t}×${c[t]}` : t);
  });
  Object.keys(c).forEach((t) => {
    if (!order.includes(t)) parts.push(c[t] > 1 ? `${t}×${c[t]}` : t);
  });
  return parts.length ? parts.join('、') : `${meals.length} 次记录`;
}

function countByMealType(meals) {
  const c = {};
  meals.forEach((m) => {
    const t = m.mealType || '未标注';
    c[t] = (c[t] || 0) + 1;
  });
  return c;
}

/** 是否早、午、晚饭时段「各至少有一条记录」（按类型，不是按条数=3） */
function hasBreakfastLunchDinner(countBy) {
  return (
    (countBy['早饭'] || 0) >= 1 &&
    (countBy['午饭'] || 0) >= 1 &&
    (countBy['晚饭'] || 0) >= 1
  );
}

function aggregateMeals(meals) {
  let totalCal = 0;
  let totalP = 0;
  let totalC = 0;
  let totalF = 0;
  let totalFi = 0;
  const calByType = {};
  let foodBlob = '';
  meals.forEach((m) => {
    const cal = m.calories || 0;
    totalCal += cal;
    totalP += m.protein || 0;
    totalC += m.carbs || 0;
    totalF += m.fat || 0;
    totalFi += m.fiber || 0;
    const t = m.mealType || '未标注';
    calByType[t] = (calByType[t] || 0) + cal;
    foodBlob += `${m.foodName || ''} `;
  });
  const nightCal = (calByType['晚饭'] || 0) + (calByType['夜宵'] || 0);
  const nightRatio = totalCal > 0 ? nightCal / totalCal : 0;
  return {
    totalCal,
    totalP,
    totalC,
    totalF,
    totalFi,
    calByType,
    foodBlob,
    nightRatio,
  };
}

const RE_TREAT = /奶茶|蛋糕|甜品|冰淇淋|巧克力|炸鸡|薯条|烧烤|油炸|泡面|方便面|辣条|可乐|奶盖|火锅/;
const RE_LIGHT = /沙拉|蔬菜|鸡胸|燕麦|水煮|无糖|清蒸|杂粮|全麦|西兰花/;

/**
 * 结合餐次类型、营养聚合、食物关键词与热量进度生成标签（不将「记录 N 次」等同于三餐）
 * @param {{ meals: Array, percent: number, intake: number, target: number }} p
 */
function computeBehaviorTag({ meals, percent, intake, target }) {
  const list = Array.isArray(meals) ? meals : [];
  const mc = list.length;
  const hasIntake = (intake || 0) > 0;
  const rawPct =
    typeof percent === 'number'
      ? percent
      : target > 0 && hasIntake
        ? (intake / target) * 100
        : 0;
  const pctRounded = Math.min(999, Math.round(rawPct));

  if (!hasIntake && mc === 0) {
    return {
      behaviorEmoji: '🥔',
      behaviorTag: '空仓待投喂',
      behaviorSub: '今天还没记录饮食，去和土豆泥打个招呼吧～',
    };
  }
  if (!hasIntake && mc > 0) {
    return {
      behaviorEmoji: '📝',
      behaviorTag: '记录已同步',
      behaviorSub: `有 ${mc} 条记录，热量合计为 0，请检查是否异常`,
    };
  }

  const agg = aggregateMeals(list);
  const countBy = countByMealType(list);
  const slotLine = describeMealSlots(list);
  const baseIntro = `${slotLine} · 共 ${mc} 条 · 约 ${Math.round(intake)}kcal`;

  if (rawPct >= 118) {
    return {
      behaviorEmoji: '🔥',
      behaviorTag: '热量明显高于目标',
      behaviorSub: `${baseIntro}。比今日目标高约 ${pctRounded - 100}%`,
    };
  }

  const pShare = agg.totalCal > 0 ? (agg.totalP * 4) / agg.totalCal : 0;
  const fShare = agg.totalCal > 0 ? (agg.totalF * 9) / agg.totalCal : 0;
  const hasTreat = RE_TREAT.test(agg.foodBlob);
  const hasLight = RE_LIGHT.test(agg.foodBlob);

  if (rawPct >= 100) {
    return {
      behaviorEmoji: '✨',
      behaviorTag: '已达今日热量目标',
      behaviorSub: `${baseIntro}。蛋白约 ${Math.round(agg.totalP)}g，膳食纤维约 ${Math.round(agg.totalFi * 10) / 10}g`,
    };
  }

  // 傍晚/夜间热量占比高（按实际标注的晚饭+夜宵）
  if (mc >= 2 && agg.nightRatio >= 0.52) {
    return {
      behaviorEmoji: '🌙',
      behaviorTag: '夜间时段热量偏多',
      behaviorSub: `${baseIntro}。晚饭/夜宵约占今日热量 ${Math.round(agg.nightRatio * 100)}%`,
    };
  }

  if (hasBreakfastLunchDinner(countBy)) {
    return {
      behaviorEmoji: '🍱',
      behaviorTag: '早中晚时段都有记录',
      behaviorSub: `${baseIntro}。早饭、午饭、晚饭时段各至少有 1 条记录`,
    };
  }

  if (pShare >= 0.24) {
    return {
      behaviorEmoji: '💪',
      behaviorTag: '蛋白质结构不错',
      behaviorSub: `${baseIntro}。蛋白供能比约 ${Math.round(pShare * 100)}%`,
    };
  }

  if (pShare < 0.13 && agg.totalCal > 450) {
    return {
      behaviorEmoji: '🥛',
      behaviorTag: '蛋白略偏少',
      behaviorSub: `${baseIntro}。蛋白供能比约 ${Math.round(pShare * 100)}%，可搭配蛋奶豆肉`,
    };
  }

  if (agg.totalFi >= 14) {
    return {
      behaviorEmoji: '🥬',
      behaviorTag: '膳食纤维摄入不错',
      behaviorSub: `${baseIntro}。纤维合计约 ${Math.round(agg.totalFi * 10) / 10}g`,
    };
  }

  if (fShare >= 0.38) {
    return {
      behaviorEmoji: '🧈',
      behaviorTag: '脂肪供能偏高',
      behaviorSub: `${baseIntro}。脂肪供能比约 ${Math.round(fShare * 100)}%`,
    };
  }

  if (hasTreat && !hasLight) {
    return {
      behaviorEmoji: '🍟',
      behaviorTag: '今日有偏「放纵」款',
      behaviorSub: `${baseIntro}。记录里出现了较高油糖/油炸等关键词，偶尔无妨～`,
    };
  }

  if (hasLight) {
    return {
      behaviorEmoji: '🥗',
      behaviorTag: '偏清淡向',
      behaviorSub: `${baseIntro}。记录里有不少清淡/蔬菜等关键词`,
    };
  }

  if (rawPct >= 78) {
    return {
      behaviorEmoji: '⛳',
      behaviorTag: '接近日热量目标',
      behaviorSub: `${baseIntro}。约完成 ${pctRounded}%`,
    };
  }

  if (rawPct >= 42) {
    return {
      behaviorEmoji: '📊',
      behaviorTag: '摄入进度过半',
      behaviorSub: `${baseIntro}。约完成 ${pctRounded}%`,
    };
  }

  if (rawPct >= 15) {
    return {
      behaviorEmoji: '🌱',
      behaviorTag: '摄入尚在积累',
      behaviorSub: `${baseIntro}。约完成 ${pctRounded}%`,
    };
  }

  return {
    behaviorEmoji: '🥄',
    behaviorTag: '今日摄入还不多',
    behaviorSub: `${baseIntro}。约完成 ${pctRounded}%`,
  };
}

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    hasLogin: false,
    hasHealthProfile: false,
    profileTagEmoji: '',
    profileTagText: '',
    profileLine1: '',
    profileLine2: '',
    showSettingsSheet: false,
    dailyIntake: 0,
    targetCalories: 1800,
    caloriePercent: 0,
    mealCount: 0,
    behaviorEmoji: '🥔',
    behaviorTag: '空仓待投喂',
    behaviorSub: '加载今日数据中…',
    todayShort: '',
    todayMeals: [],
    nutritionMetrics: [],
    hasNutritionProfile: false,
    // 弹窗
    showSheet: false,
    draftAvatarUrl: '',
    draftNickName: '',
  },

  onLoad() {
    this.setTodayLabel();
    this.loadUserInfo();
    this.loadAppData();
  },

  onShow() {
    this.setTodayLabel();
    this.loadUserInfo();
    this.loadAppData();
  },

  setTodayLabel() {
    const d = new Date();
    const todayShort = `${d.getMonth() + 1}月${d.getDate()}日`;
    this.setData({ todayShort });
  },

  loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    const hasLogin = !!(userInfo.avatarUrl || userInfo.nickName);
    this.setData({
      avatarUrl: userInfo.avatarUrl || '',
      nickName: userInfo.nickName || '',
      hasLogin,
    });
  },

  loadAppData() {
    const targetCalories = app.globalData.targetCalories ?? 1800;
    const dailyIntake = app.globalData.dailyIntake ?? 0;
    const rawPct =
      targetCalories > 0 ? (dailyIntake / targetCalories) * 100 : 0;
    const caloriePercent =
      targetCalories > 0 ? Math.min(100, Math.round(rawPct)) : 0;
    const b = computeBehaviorTag({
      meals: [],
      percent: rawPct,
      intake: dailyIntake,
      target: targetCalories,
    });
    const macroT = macroTargetsFromServerProfile(null, targetCalories);
    const nutritionMetrics = buildNutritionMetrics(
      aggregateMeals([]),
      macroT,
    );
    const pd = flattenProfileDisplay(null);
    this.setData({
      dailyIntake,
      targetCalories,
      caloriePercent,
      todayMeals: [],
      nutritionMetrics,
      hasNutritionProfile: false,
      ...pd,
      ...b,
    });
    this.refreshTodayFromServer();
  },

  /** 已登录时拉今日统计 + 档案目标，更新列表、进度条与行为标签 */
  refreshTodayFromServer() {
    const openid = app.globalData.openid || app.globalData.userInfo?.openid;
    if (!openid) return;
    Promise.all([
      getDailyStats(openid),
      getUserProfile(openid).catch(() => ({
        hasProfile: false,
        targetCalories: 1800,
      })),
    ])
      .then(([stats, up]) => {
        const total = stats.totalCalories || 0;
        const meals = stats.meals || [];
        const mealCount = meals.length;
        let targetCalories =
          (up && up.targetCalories) ||
          app.globalData.targetCalories ||
          this.data.targetCalories ||
          1800;
        if (up && up.hasProfile && up.profile && up.profile.dailyCalories) {
          targetCalories = up.profile.dailyCalories;
          app.globalData.targetCalories = targetCalories;
          wx.setStorageSync('targetCalories', targetCalories);
        }
        const rawPct =
          targetCalories > 0 ? (total / targetCalories) * 100 : 0;
        const caloriePercent = Math.min(100, Math.round(rawPct));
        const macroT = macroTargetsFromServerProfile(
          up && up.profile,
          targetCalories,
        );
        const agg = aggregateMeals(meals);
        const nutritionMetrics = buildNutritionMetrics(agg, macroT);
        const todayMeals = formatMealList(meals);
        const b = computeBehaviorTag({
          meals,
          percent: rawPct,
          intake: total,
          target: targetCalories,
        });
        app.globalData.dailyIntake = total;
        wx.setStorageSync('dailyIntake', total);
        const pd = flattenProfileDisplay(up);
        this.setData({
          dailyIntake: total,
          mealCount,
          targetCalories,
          caloriePercent,
          todayMeals,
          nutritionMetrics,
          hasNutritionProfile: !!(up && up.hasProfile),
          ...pd,
          ...b,
        });
      })
      .catch(() => {
        /* 离线或接口失败时保留本地 globalData */
      });
  },

  closeSettingsSheet() {
    this.setData({ showSettingsSheet: false });
  },

  /** 点击昵称：已登录弹出退出；未登录走登录 */
  onTapName() {
    if (!this.data.hasLogin) {
      this.openLoginSheet();
      return;
    }
    this.setData({ showSettingsSheet: true });
  },

  onTapAvatar() {
    if (!this.data.hasLogin) {
      this.openLoginSheet();
    }
  },

  // ===== 弹窗 =====

  openLoginSheet() {
    // 用已保存的头像/昵称初始化草稿
    this.setData({
      showSheet: true,
      draftAvatarUrl: this.data.avatarUrl,
      draftNickName: this.data.nickName,
    });
  },

  closeLoginSheet() {
    this.setData({ showSheet: false });
  },

  // 弹窗内选头像（临时保存到 draftAvatarUrl）
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    const fs = wx.getFileSystemManager();
    const that = this;
    fs.saveFile({
      tempFilePath: avatarUrl,
      success(res) { that.setData({ draftAvatarUrl: res.savedFilePath }); },
      fail() { that.setData({ draftAvatarUrl: avatarUrl }); },
    });
  },

  // 弹窗内填昵称（临时）
  onDraftNicknameInput(e) {
    this.setData({ draftNickName: (e.detail.value || '').trim() });
  },

  // 点「完成登录」：code 换 openid，写入存储
  async confirmLogin() {
    const { draftAvatarUrl, draftNickName } = this.data;
    if (!draftAvatarUrl && !draftNickName) {
      wx.showToast({ title: '请先选择头像或填写昵称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '登录中…' });
    try {
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({
          success: (r) => (r.code ? resolve(r.code) : reject(new Error('未获取到 code'))),
          fail: reject,
        });
      });
      const { openid } = await requestLogin(loginRes);

      const userInfo = {
        avatarUrl: draftAvatarUrl,
        nickName: draftNickName,
        openid,
      };
      wx.setStorageSync('userInfo', userInfo);
      if (app.globalData) {
        app.globalData.userInfo = userInfo;
        app.globalData.openid = openid;
      }

      this.setData({
        avatarUrl: draftAvatarUrl,
        nickName: draftNickName,
        hasLogin: true,
        showSheet: false,
      });
      wx.hideLoading();
      wx.showToast({ title: '登录成功', icon: 'success' });
      this.loadAppData();
    } catch (err) {
      console.error('[confirmLogin] 登录失败:', err);
      wx.hideLoading();
      wx.showToast({ title: err.message || '登录失败', icon: 'none' });
    }
  },

  // ===== 退出登录（点击昵称） =====

  doLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号吗？',
      confirmColor: '#e03131',
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync('userInfo');
        if (app.globalData) {
          app.globalData.userInfo = null;
          app.globalData.openid = null;
        }
        this.setData({
          showSettingsSheet: false,
          avatarUrl: '',
          nickName: '',
          hasLogin: false,
          hasHealthProfile: false,
          hasNutritionProfile: false,
          profileTagEmoji: '',
          profileTagText: '',
          profileLine1: '',
          profileLine2: '',
        });
        this.loadAppData();
        wx.showToast({ title: '已退出', icon: 'none' });
      },
    });
  },
});
