const {
  sendMessage,
  uploadImage,
  getChatHistory,
  getUserProfile,
  confirmMeal,
  confirmProfilePlan,
  rejectMeal,
  getDailyStats,
} = require('../../utils/request');

let msgIdCounter = 0;
function genId() {
  return ++msgIdCounter;
}

Page({
  data: {
    statusBarHeight: 0,
    /** adjust-position=false 时，用 fixed 的 bottom 贴合键盘上沿 */
    keyboardHeight: 0,
    /** scroll-view 底部内边距 = 输入栏高度 + keyboardHeight（无流式占位，避免空隙翻倍） */
    scrollAreaPaddingBottom: 100,
    todayLabel: '',
    messages: [],
    inputText: '',
    dailyIntake: 0,
    targetCalories: 1800,
    caloriePercent: 0,
    scrollToId: '',
    isLoading: false,
    isLoadingHistory: false,
    openid: '',
    avatarUrl: '',
  },

  onShow() {
    const app = getApp();
    const newOpenid = app.globalData.openid || app.globalData.userInfo?.openid || '';
    const prevOpenid = this.data.openid || '';
    const avatarUrl = app.globalData.userInfo?.avatarUrl || '';
    this.setData({ avatarUrl });
    if (newOpenid === prevOpenid) return;

    this.setData({ openid: newOpenid });
    if (newOpenid) {
      this._loadHistory(newOpenid);
    } else {
      this.setData({ messages: [], dailyIntake: 0, caloriePercent: 0 });
      this._addAIGreeting();
    }
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: systemInfo.statusBarHeight });

    const app = getApp();
    const targetCalories = app.globalData.targetCalories;
    const openid = app.globalData.openid || app.globalData.userInfo?.openid || '';
    const avatarUrl = app.globalData.userInfo?.avatarUrl || '';

    const now = new Date();
    const todayLabel = `今天 · ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

    this.setData({ targetCalories, todayLabel, openid, avatarUrl });

    if (openid) {
      this._loadHistory(openid);
    } else {
      this._addAIGreeting();
    }
  },

  onReady() {
    this._measureInputBarAndSyncPadding();
  },

  /** 输入栏高度（px），用于 scroll 底部留白 */
  _inputBarHeightPx: 0,

  _measureInputBarAndSyncPadding() {
    wx.createSelectorQuery()
      .in(this)
      .select('.chat-input-bar')
      .boundingClientRect((rect) => {
        if (rect && rect.height > 0) {
          this._inputBarHeightPx = rect.height;
        }
        this._syncChatScrollPadding();
      })
      .exec();
  },

  _syncChatScrollPadding() {
    const kb = this.data.keyboardHeight || 0;
    const bar = this._inputBarHeightPx || 56;
    this.setData({ scrollAreaPaddingBottom: bar + kb });
  },

  async _loadHistory(openid) {
    this.setData({ isLoadingHistory: true, messages: [] });
    try {
      // 并行：聊天记录、今日统计、用户档案（每日热量目标）
      const [list, stats, userProf] = await Promise.all([
        getChatHistory(openid),
        getDailyStats(openid).catch(() => ({ totalCalories: 0, meals: [] })),
        getUserProfile(openid).catch(() => ({ hasProfile: false, targetCalories: 1800 })),
      ]);

      if (userProf && userProf.hasProfile && userProf.targetCalories) {
        const tc = userProf.targetCalories;
        this.setData({ targetCalories: tc });
        getApp().globalData.targetCalories = tc;
        wx.setStorageSync('targetCalories', tc);
      }

      // 今日热量从服务端 meal_records 获取（权威数据源）
      const serverCalories = stats.totalCalories || 0;

      if (!list || list.length === 0) {
        this.setData({ isLoadingHistory: false });
        this._applyCalories(serverCalories);
        this._addAIGreeting();
        return;
      }

      const messages = [];
      const today = new Date().toDateString();
      let cumulativeCalories = 0;

      for (const r of list) {
        const isToday = r.createdAt
          ? new Date(r.createdAt).toDateString() === today
          : false;

        if (r.role === 'user') {
          const isImg = String(r.content || '').startsWith('[图片]');
          const text = isImg ? r.content.replace(/^\[图片\]\s*/, '') : r.content;
          messages.push({
            id: genId(),
            role: 'user',
            type: 'text',
            text: isImg ? `📷 ${text}` : text,
          });
        } else {
          const aiMsg = {
            id: genId(),
            role: 'ai',
            type: r.type || 'chat',
            text: r.content,
            suggestion: r.suggestion,
          };
          if (r.type === 'profile_plan') {
            aiMsg.type = 'profile_plan';
          }
          if (r.nutrition) {
            if (isToday) cumulativeCalories += r.nutrition.calories || 0;
            aiMsg.nutrition = {
              ...r.nutrition,
              afterIntake: cumulativeCalories,
              afterPercent: Math.min(
                Math.round((cumulativeCalories / this.data.targetCalories) * 100),
                100,
              ),
            };
          }
          // 从数据库还原卡片数据，并根据 cardStatus 渲染已确认/已取消状态
          if (r.type === 'card') {
            if (r.card) aiMsg.card = r.card;
            aiMsg.confirmed = true; // 历史卡片已被处理（确认或取消）
            aiMsg.rejected = r.cardStatus === 'rejected';
          }
          if (r.type === 'profile_plan' && r.card) {
            aiMsg.card = r.card;
            aiMsg.confirmed = true;
            aiMsg.rejected = r.cardStatus === 'rejected';
          }
          if (r.type === 'profile_guide' && r.profileGuide) {
            aiMsg.type = 'profile_guide';
            aiMsg.profileGuide = r.profileGuide;
          }
          if (r.type === 'summary' && r.card) {
            aiMsg.type = 'summary';
            aiMsg.summaryCard = r.card;
          }
          messages.push(aiMsg);
        }
      }

      messages.push({ id: genId(), role: 'system', type: 'history-end' });

      // 热量以服务端 meal_records 为准
      this.setData({ messages, isLoadingHistory: false });
      this._applyCalories(serverCalories);
      this._scrollToBottom();
    } catch (e) {
      console.error('[_loadHistory] error:', e);
      this.setData({ isLoadingHistory: false });
      this._addAIGreeting();
    }
  },

  _applyCalories(calories) {
    const caloriePercent = Math.min(
      Math.round((calories / this.data.targetCalories) * 100),
      100,
    );
    this.setData({ dailyIntake: calories, caloriePercent });
    getApp().globalData.dailyIntake = calories;
    wx.setStorageSync('dailyIntake', calories);
  },

  _addAIGreeting() {
    const greeting = {
      id: genId(),
      role: 'ai',
      type: 'chat',
      text: `你好！我是你的 AI 营养师柯基 🐶 \n今天吃了什么？拍张照片或描述一下吧～`,
    };
    this.setData({ messages: [greeting] });
    this._scrollToBottom();
  },

  onInputChange(e) {
    this.setData({ inputText: e.detail.value });
  },

  onKeyboardHeightChange(e) {
    const h = e.detail.height || 0;
    this.setData({ keyboardHeight: h }, () => {
      this._syncChatScrollPadding();
      if (h > 0) {
        this._scrollToBottom();
      }
    });
  },

  onInputBlur() {
    this.setData({ keyboardHeight: 0 }, () => {
      this._syncChatScrollPadding();
    });
  },

  async sendMessage() {
    const text = this.data.inputText.trim();
    if (!text || this.data.isLoading) return;

    this.setData({ inputText: '', isLoading: true });

    const userMsg = { id: genId(), role: 'user', type: 'text', text };
    this.setData({ messages: [...this.data.messages, userMsg] });
    this._scrollToBottom();

    const typingId = genId();
    this.setData({ messages: [...this.data.messages, { id: typingId, role: 'ai', type: 'typing' }] });
    this._scrollToBottom();

    try {
      const res = await sendMessage({
        message: text,
        openid: this.data.openid,
        targetCalories: this.data.targetCalories,
        userProfile: this._getUserProfile(),
      });

      const aiMsgs = this._buildAIMessages(res);
      const newMessages = this.data.messages.filter(m => m.id !== typingId).concat(aiMsgs);

      this.setData({ messages: newMessages, isLoading: false });
      this._scrollToBottom();
    } catch (err) {
      this._removeTypingAndAddError(typingId, err.message || '网络错误，请重试');
    }
  },

  async chooseImage() {
    if (this.data.isLoading) return;

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (mediaRes) => {
        const filePath = mediaRes.tempFiles[0].tempFilePath;

        // 一次 setData 同时加入图片气泡 + typing，避免连续 setData 的竞态覆盖
        const imgMsgId = genId();
        const typingId = genId();
        this.setData({
          isLoading: true,
          messages: [
            ...this.data.messages,
            { id: imgMsgId, role: 'user', type: 'image', imagePath: filePath, caption: '', uploading: true },
            { id: typingId, role: 'ai', type: 'typing' },
          ],
        });
        this._scrollToBottom();

        try {
          const res = await uploadImage({
            filePath,
            targetCalories: this.data.targetCalories,
            openid: this.data.openid,
            userProfile: this._getUserProfile(),
          });

          const aiMsgs = this._buildAIMessages(res);
          // 移除 typing，更新图片 caption/uploading，追加 AI 回复
          const finalMessages = this.data.messages
            .filter(m => m.id !== typingId)
            .map(m => m.id === imgMsgId
              ? { ...m, caption: res.recognizedFood || '', uploading: false }
              : m,
            )
            .concat(aiMsgs);

          this.setData({ messages: finalMessages, isLoading: false });
          this._scrollToBottom();
        } catch (err) {
          // 标记上传失败，移除 typing，追加错误提示
          const failMessages = this.data.messages
            .filter(m => m.id !== typingId)
            .map(m => m.id === imgMsgId
              ? { ...m, uploading: false, uploadFailed: true }
              : m,
            )
            .concat({ id: genId(), role: 'ai', type: 'chat', text: `识别失败，请重试 😔` });
          this.setData({ messages: failMessages, isLoading: false });
          this._scrollToBottom();
        }
      },
      fail(err) {
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.includes('cancel') || msg.includes('取消')) return;
        if (msg.includes('auth') || msg.includes('authorize') || msg.includes('deny')) {
          wx.showModal({
            title: '需要相机/相册权限',
            content: '请在设置中允许访问相机和相册',
            confirmText: '去设置',
            cancelText: '取消',
            success(r) { if (r.confirm) wx.openSetting(); },
          });
          return;
        }
        wx.showToast({ title: '选择图片失败', icon: 'none', duration: 2000 });
      },
    });
  },

  // 点击图片全屏预览
  previewImage(e) {
    const src = e.currentTarget.dataset.src;
    if (src) wx.previewImage({ urls: [src], current: src });
  },

  _getUserProfile() {
    const app = getApp();
    const userInfo = app.globalData.userInfo || {};
    return {
      height: userInfo.height || '',
      weight: userInfo.weight || '',
      medicalHistory: userInfo.medicalHistory || '',
      allergies: userInfo.allergies || '',
      preferences: userInfo.preferences || '',
    };
  },

  // 返回数组，通常只有 1 条；若后端有 followUp 则返回 2 条气泡
  _buildAIMessages(res) {
    const msg = {
      id: genId(),
      role: 'ai',
      type: res.type || 'chat',
      text: res.text || '',
      suggestion: res.suggestion || '',
    };

    if (res.type === 'nutrition' && res.nutrition) {
      const afterIntake = this.data.dailyIntake + res.nutrition.calories;
      const afterPercent = Math.min(
        Math.round((afterIntake / this.data.targetCalories) * 100),
        100,
      );
      msg.nutrition = { ...res.nutrition, afterIntake, afterPercent };
    }

    if (res.type === 'card' && res.card) {
      msg.card = res.card;
      msg.confirmed = false;
    }

    if (res.type === 'profile_plan' && res.profilePlanCard) {
      msg.type = 'profile_plan';
      msg.card = res.profilePlanCard;
      msg.confirmed = false;
    }

    if (res.type === 'profile_guide' && res.profileGuide) {
      msg.type = 'profile_guide';
      msg.profileGuide = res.profileGuide;
    }

    if (res.type === 'summary' && res.summaryCard) {
      msg.type = 'summary';
      msg.summaryCard = res.summaryCard;
    }

    if (res.targetCalories && res.targetCalories > 0) {
      getApp().globalData.targetCalories = res.targetCalories;
      wx.setStorageSync('targetCalories', res.targetCalories);
      this.setData({ targetCalories: res.targetCalories });
    }

    if (res.followUp) {
      return [msg, { id: genId(), role: 'ai', type: 'chat', text: res.followUp, suggestion: '' }];
    }
    return [msg];
  },

  // 用户点击「确认记录」- 调用后端保存并获取今日建议
  async confirmCard(e) {
    const cardId = e.currentTarget.dataset.id;
    const card = this.data.messages.find(m => m.id === cardId);
    if (!card || !card.card || this.data.isLoading) return;

    const isProfile = card.type === 'profile_plan' || card.card.cardKind === 'profile_plan';

    // 乐观更新：先标记为已确认
    const messages = this.data.messages.map(m =>
      m.id !== cardId ? m : { ...m, confirmed: true },
    );
    this.setData({ messages, isLoading: true });

    const typingId = genId();
    this.setData({
      messages: [...this.data.messages, { id: typingId, role: 'ai', type: 'typing' }],
    });
    this._scrollToBottom();

    try {
      if (this.data.openid) {
        let res;
        if (isProfile) {
          res = await confirmProfilePlan({
            openid: this.data.openid,
            plan: card.card,
          });
        } else {
          res = await confirmMeal({
            openid: this.data.openid,
            card: card.card,
            targetCalories: this.data.targetCalories,
            userProfile: this._getUserProfile(),
          });
        }

        if (!isProfile) {
          const newDailyIntake = this.data.dailyIntake + card.card.calories;
          this._applyCalories(newDailyIntake);
        } else if (res.targetCalories) {
          this.setData({ targetCalories: res.targetCalories });
          getApp().globalData.targetCalories = res.targetCalories;
          wx.setStorageSync('targetCalories', res.targetCalories);
        }

        // 显示营养卡 + 今日建议（或档案确认后的文案）
        const aiMsgs = this._buildAIMessages(res);
        const finalMessages = this.data.messages
          .filter(m => m.id !== typingId)
          .concat(aiMsgs);
        this.setData({ messages: finalMessages, isLoading: false });
        this._scrollToBottom();
      } else {
        // 未登录
        if (!isProfile) {
          const newDailyIntake = this.data.dailyIntake + card.card.calories;
          this._applyCalories(newDailyIntake);
        }
        this.setData({
          messages: this.data.messages.filter(m => m.id !== typingId),
          isLoading: false,
        });
        wx.showToast({
          title: isProfile ? '请先登录' : '已记录 🎉',
          icon: isProfile ? 'none' : 'success',
          duration: 1500,
        });
      }
    } catch (err) {
      console.error('[confirmCard] error:', err);
      // 回滚乐观更新
      const rolledBack = this.data.messages.map(m =>
        m.id !== cardId ? m : { ...m, confirmed: false },
      );
      this.setData({
        messages: rolledBack.filter(m => m.id !== typingId),
        isLoading: false,
      });
      wx.showToast({ title: '记录失败，请重试', icon: 'none' });
    }
  },

  // 用户点击「取消」- 调用后端重置状态
  async rejectCard(e) {
    const cardId = e.currentTarget.dataset.id;
    const messages = this.data.messages.map(m =>
      m.id !== cardId ? m : { ...m, confirmed: true, rejected: true },
    );
    this.setData({ messages });
    wx.showToast({ title: '已取消', icon: 'none', duration: 1200 });

    if (this.data.openid) {
      try {
        const res = await rejectMeal({ openid: this.data.openid });
        if (res && res.text) {
          const aiMsgs = this._buildAIMessages(res);
          this.setData({ messages: [...this.data.messages, ...aiMsgs] });
          this._scrollToBottom();
        }
      } catch (err) {
        console.error('[rejectCard] error:', err);
      }
    }
  },

  _removeTypingAndAddError(typingId, errorText) {
    const newMessages = this.data.messages
      .filter(m => m.id !== typingId)
      .concat({
        id: genId(),
        role: 'ai',
        type: 'chat',
        text: `抱歉，出现了点问题 😔\n${errorText}`,
      });
    this.setData({ messages: newMessages, isLoading: false });
    this._scrollToBottom();
  },

  _scrollToBottom() {
    this.setData({ scrollToId: 'chat-bottom' });
  },
});
