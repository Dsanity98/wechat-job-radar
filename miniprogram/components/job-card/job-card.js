const applications = require('../../services/applications')

Component({
  properties: {
    job: {
      type: Object,
      value: null
    }
  },

  data: {
    applied: false
  },

  observers: {
    job() {
      this.syncApplied()
    }
  },

  pageLifetimes: {
    show() {
      this.syncApplied()
    }
  },

  methods: {
    syncApplied() {
      const job = this.data.job
      this.setData({ applied: job && job.id ? applications.has(job.id) : false })
    },

    onTap() {
      const job = this.data.job
      if (job && job.id) {
        this.triggerEvent('jobtap', { id: job.id })
      }
    }
  }
})
