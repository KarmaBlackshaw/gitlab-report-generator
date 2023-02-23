const axios = require('axios')
const moment = require('moment')
const dedent = require('dedent')
const Promise = require('bluebird')
const fs = Promise.promisifyAll(require('fs-extra'))

const { PROJECT_FILE_PATH } = require('./constants')
const ACCESS_TOKEN = process.env.ACCESS_TOKEN

module.exports = {
  async generateReport ({
    email,
    include_merge: includeMerge,
    limit = Infinity
  }) {
    try {
      const projects = await fs.readJSON(PROJECT_FILE_PATH)

      let totalCommits = 0

      await Promise.map(
        projects,
        async project => {
          const {
            data: commits
          } = await axios.get(`https://gitlab.com/api/v4/projects/${project.id}/repository/commits`, {
            params: {
              access_token: ACCESS_TOKEN,
              since: moment().startOf('day'),
              all: true
            }
          })

          project.commits = commits
            .filter(commit => {
              if (!includeMerge && commit.title.includes('Merge branch')) {
                return false
              }

              if (commit.committer_email !== email) {
                return false
              }

              totalCommits += 1

              if (totalCommits > limit) {
                return false
              }

              return true
            })
            .map(commit => ({
              id: commit.id,
              created_at: commit.created_at,
              committer_email: commit.committer_email,
              web_url: commit.web_url,
              title: commit.title.includes('Merge branch')
                ? 'Code review'
                : commit.title
            }))
        },
        { concurrency: 10 }
      )

      const projectsWithCommits = projects
        .filter(x => x.commits.length)

      let report = ''
      projectsWithCommits.forEach(project => {
        const text = `Updates for *${project.path_with_namespace}*`
        const commits = project.commits.map(commit => {
          return ` - [${commit.title}](${commit.web_url})`
        }).join('\n')

        report += dedent(`
          \n${text}
          ${commits}\n
        `)

        report += '\n\n'
      })

      return dedent(report)
    } catch (error) {
      console.log(error)
      throw error
    }
  }
}
