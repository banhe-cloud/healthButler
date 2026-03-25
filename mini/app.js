App({
  globalData: {
    userInfo: null,
    dailyIntake: 0,
    targetCalories: 1800,
    openid: null,
  },
  onLaunch() {
    const dailyIntake = wx.getStorageSync('dailyIntake') || 0;
    const targetCalories = wx.getStorageSync('targetCalories') || 1800;
    const userInfo = wx.getStorageSync('userInfo') || null;
    this.globalData.dailyIntake = dailyIntake;
    this.globalData.targetCalories = targetCalories;
    this.globalData.userInfo = userInfo;
    this.globalData.openid = userInfo?.openid || null;
  },
});
