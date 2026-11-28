Component({
  properties: {
    job: {
      type: Object,
      value: null
    }
  },

  methods: {
    onTap() {
      const job = this.data.job
      if (job && job.id) {
        this.triggerEvent('jobtap', { id: job.id })
      }
    }
  }
})
