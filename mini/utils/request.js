const BASE_URL = 'http://localhost:3000';

/**
 * 微信 code 换 openid
 */
function login(code) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/auth/login`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { code },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          console.error('[login] 服务端响应:', res.statusCode, JSON.stringify(res.data));
          reject(new Error(res.data?.message || `登录失败(${res.statusCode})`));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/**
 * 拉取聊天记录
 */
function getChatHistory(openid) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/chat/history`,
      method: 'GET',
      data: { openid },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data || []);
        } else {
          reject(new Error(res.data?.message || '获取失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/**
 * 发送文本消息（后端状态机驱动，不再需要传 history）
 */
function sendMessage({
  message,
  openid,
  targetCalories = 1800,
  userProfile,
  // 以下参数保留兼容性
  history,
  dailyIntake,
}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/chat/message`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { message, openid, targetCalories, userProfile },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || '请求失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/**
 * 确认营养卡片，保存餐食记录
 */
function confirmMeal({ openid, card, targetCalories = 1800, userProfile }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/chat/confirm`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { openid, card, targetCalories, userProfile },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || '确认失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/**
 * 取消营养卡片
 */
function rejectMeal({ openid }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/chat/reject`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { openid },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || '取消失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/**
 * 获取今日餐食统计
 */
function getDailyStats(openid) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/chat/daily-stats`,
      method: 'GET',
      data: { openid },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || '获取失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/**
 * 获取本周饮食报告
 */
function getWeeklyReport({ openid, targetCalories = 1800, userProfile }) {
  const userProfileStr = userProfile ? JSON.stringify(userProfile) : '';
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/chat/weekly-report`,
      method: 'GET',
      data: { openid, targetCalories, userProfile: userProfileStr },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || '获取失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/**
 * 上传食物图片
 */
function uploadImage({
  filePath,
  dailyIntake = 0,
  targetCalories = 1800,
  openid,
  userProfile,
}) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${BASE_URL}/chat/image`,
      filePath,
      name: 'image',
      formData: {
        dailyIntake: String(dailyIntake),
        targetCalories: String(targetCalories),
        openid: openid || '',
        userProfile: userProfile ? JSON.stringify(userProfile) : '',
      },
      success(res) {
        try {
          const data =
            typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(data?.message || '上传失败'));
          }
        } catch {
          reject(new Error('响应解析失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '上传失败'));
      },
    });
  });
}

/** 是否已建档及每日热量目标 */
function getUserProfile(openid) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/chat/user-profile`,
      method: 'GET',
      data: { openid },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || '获取失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/** 确认健康档案与每日摄入计划 */
function confirmProfilePlan({ openid, plan }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}/chat/confirm-profile`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { openid, plan },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.message || '确认失败'));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

module.exports = {
  login,
  getChatHistory,
  getUserProfile,
  sendMessage,
  confirmMeal,
  confirmProfilePlan,
  rejectMeal,
  getDailyStats,
  getWeeklyReport,
  uploadImage,
};
